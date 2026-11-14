import json
import os
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select

from ytanalytics.ai import AIRunner, latest_insight
from ytanalytics.budget import plan_minutes, record_job
from ytanalytics.db import utcnow  # noqa: E402
from ytanalytics.db import (
    Base, Channel, Comment, Insight, LlmUsage, RunLog, Video, init_db, make_engine, make_session_factory,
)
from ytanalytics.llm import LLMRouter, ModelSlot, NoModelAvailable, parse_json, slots_from_env
from ytanalytics.sentiment import analyze_pending
from ytanalytics.config import Settings, normalize_db_url


@pytest.fixture
def session():
    engine = make_engine(normalize_db_url(os.environ.get("TEST_DATABASE_URL", "sqlite://")))
    Base.metadata.drop_all(engine)
    init_db(engine)
    with make_session_factory(engine)() as s:
        yield s
    engine.dispose()


# ------------------------------------------------------------------ fake HTTP for the router
class Resp:
    def __init__(self, status, body=None, headers=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.text = body if isinstance(body, str) else json.dumps(self._body)
        self.headers = headers or {}

    def json(self):
        if isinstance(self._body, str):
            raise ValueError("not json")
        return self._body


def ok(content: str):
    return Resp(200, {"choices": [{"message": {"content": content}}], "usage": {"total_tokens": 100}})


class FakeHTTP:
    """Returns queued responses per model name."""

    def __init__(self, script):
        self.script = {k: list(v) for k, v in script.items()}
        self.calls = []

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append((json["model"], json))
        return self.script[json["model"]].pop(0)


def slot(model, provider="gemini", daily=100):
    return ModelSlot(provider=provider, base_url="https://x/", api_key="k", model=model,
                     daily_requests=daily, seconds_between=0)


def test_parse_json_tolerates_fences_and_chatter():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('Sure! {"a": [1, 2]} hope that helps') == {"a": [1, 2]}
    with pytest.raises(ValueError):
        parse_json("no json here")


def test_router_falls_back_when_daily_limit_hit(session):
    http = FakeHTTP({
        "m1": [Resp(429, "Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier")],
        "m2": [ok('{"x": 1}'), ok('{"x": 2}')],
    })
    router = LLMRouter(session, [slot("m1"), slot("m2")], http=http, sleep=lambda s: None)
    assert router.chat_json("sys", "user") == ({"x": 1}, "gemini/m2")
    # m1 is remembered as exhausted for today: not called again
    assert router.chat_json("sys", "user") == ({"x": 2}, "gemini/m2")
    assert [c[0] for c in http.calls] == ["m1", "m2", "m2"]
    assert session.scalars(select(LlmUsage).where(LlmUsage.model_key == "gemini/m1")).one().exhausted


def test_router_waits_on_per_minute_limit(session):
    waits = []
    http = FakeHTTP({"m1": [
        Resp(429, "Quota exceeded for metric: GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
             headers={"retry-after": "12"}),
        ok('{"ok": true}'),
    ]})
    router = LLMRouter(session, [slot("m1")], http=http, sleep=waits.append)
    assert router.chat_json("s", "u")[0] == {"ok": True}
    assert 12.0 in waits


def test_router_skips_unknown_model_and_drops_json_mode(session):
    http = FakeHTTP({
        "gone": [Resp(404, "models/gone is not found")],
        "nojson": [Resp(400, "response_format json_object is not supported"), ok('{"y": 3}')],
    })
    router = LLMRouter(session, [slot("gone"), slot("nojson")], http=http, sleep=lambda s: None)
    assert router.chat_json("s", "u") == ({"y": 3}, "gemini/nojson")
    assert "response_format" in http.calls[1][1] and "response_format" not in http.calls[2][1]


def test_router_respects_daily_request_budget(session):
    http = FakeHTTP({"m1": [ok("{}")] * 5})
    router = LLMRouter(session, [slot("m1", daily=2)], http=http, sleep=lambda s: None)
    router.chat_json("s", "u")
    router.chat_json("s", "u")
    with pytest.raises(NoModelAvailable):
        router.chat_json("s", "u")


def test_slots_from_env_order_and_keys():
    slots = slots_from_env({"GEMINI_API_KEY": "g", "GEMINI_MODELS": "a,b", "GROQ_API_KEY": "q",
                            "GROQ_MODELS": "c"})
    assert [s.key for s in slots] == ["gemini/a", "gemini/b", "groq/c"]
    assert slots_from_env({"GROQ_API_KEY": "q", "GROQ_MODELS": "c"})[0].key == "groq/c"
    assert slots_from_env({}) == []


# ------------------------------------------------------------------ AI runner with a fake router
class FakeRouter:
    """Labels comments from simple keywords, like a (very small) LLM would."""

    def __init__(self, fail_after=None):
        self.prompts = []
        self.fail_after = fail_after

    def chat_json(self, system, user, max_tokens=0, deadline=None):
        if self.fail_after is not None and len(self.prompts) >= self.fail_after:
            raise NoModelAvailable("used up")
        self.prompts.append((system, user))
        if '"results"' in system:
            results = []
            for line in user.splitlines():
                head, _, text = line.partition(". [V")
                if not head.isdigit():
                    continue
                i = int(head)
                if "skipme" in text:
                    continue
                neg = "mokka" in text or "bad" in text
                results.append({
                    "i": i, "sentiment": "negative" if neg else "positive", "score": -0.8 if neg else 0.9,
                    "emotion": "disappointment" if neg else "joy", "question": "?" in text,
                    "suggestion": "part 2" in text, "spam": "free money" in text, "toxic": False,
                    "aspects": [{"a": "audio", "s": "neg"}] if "audio" in text else [{"a": "nonsense", "s": "pos"}],
                    "lang": "ta-Latn" if ("mokka" in text or "semma" in text) else "en",
                    "en": "boring film" if "mokka" in text else "",
                })
            return {"results": results}, "gemini/fake"
        return {"summary": "People liked it.", "liked": ["editing"], "complaints": ["audio"]}, "gemini/fake"


def seed(session, n=30):
    session.add(Channel(id="UC1", title="Chan", active=True))
    session.add(Video(id="v1", channel_id="UC1", title="Phone review", published_at=datetime(2026, 1, 1)))
    session.commit()  # parents first: PostgreSQL enforces foreign keys
    texts = ["semma video bro", "mokka padam", "audio is bad", "make part 2?", "free money click", "great",
             "skipme"]
    for i in range(n):
        session.add(Comment(id=f"c{i}", video_id="v1", channel_id="UC1", text=texts[i % len(texts)],
                            like_count=i, published_at=datetime(2026, 1, 1) + timedelta(hours=i)))
    session.commit()


def test_enrich_comments_labels_and_flags(session):
    seed(session)
    router = FakeRouter()
    runner = AIRunner(session, router, batch_size=8)
    assert runner.enrich_comments() > 0
    rows = {c.text: c for c in session.scalars(select(Comment))}
    # Short reactions are labelled by rules, without spending AI requests.
    assert rows["semma video bro"].sentiment == "positive"
    assert rows["semma video bro"].language == "ta-Latn"
    assert rows["semma video bro"].sentiment_source == "rules" and rows["great"].ai_model == "rules"
    assert runner.stats["rules"] == 9
    assert rows["mokka padam"].sentiment == "negative" and rows["mokka padam"].translation == "boring film"
    assert rows["audio is bad"].aspects == "audio:neg"
    assert rows["make part 2?"].is_question and rows["make part 2?"].is_suggestion
    assert rows["free money click"].is_spam
    # A comment the model skipped stays unread, so a later batch retries it.
    assert rows["skipme"].ai_at is None and rows["skipme"].sentiment is None
    assert session.scalar(select(func.count()).select_from(Comment).where(Comment.ai_at.is_(None))) == 4
    assert not any("semma video bro" in u for _, u in router.prompts)  # never sent to the AI

    # Local model must not overwrite AI labels afterwards.
    class Clf:
        name = "local"

        def __call__(self, texts):
            return [{"negative": 1.0, "neutral": 0, "positive": 0}] * len(texts)

    analyze_pending(session, Settings.from_env(), classifier=Clf())
    session.expire_all()
    assert session.get(Comment, "c0").sentiment == "positive"


def test_enrich_reads_most_important_first(session):
    seed(session, n=14)  # like_count = i, all published long ago
    session.add(Comment(id="fresh", video_id="v1", channel_id="UC1", text="brand new opinion", like_count=0,
                        published_at=utcnow() - timedelta(hours=1)))
    session.commit()
    router = FakeRouter()
    AIRunner(session, router, batch_size=3).enrich_comments(max_batches=1)
    first_batch = router.prompts[0][1].split("Comments:")[1]
    # Last 2 days first, then the most liked (c13 "skipme", c11 "free money click"); rule-labelled ones never sent.
    assert first_batch.index("brand new opinion") < first_batch.index("skipme") < first_batch.index("free money click")
    assert "great" not in first_batch and "semma" not in first_batch


def test_enrich_stops_cleanly_when_models_used_up(session):
    seed(session)
    runner = AIRunner(session, FakeRouter(fail_after=1), batch_size=5)
    runner.enrich_comments()
    by_model = dict(session.execute(select(Comment.ai_model, func.count()).group_by(Comment.ai_model)).all())
    assert by_model["rules"] == 9 and 1 <= by_model["gemini/fake"] <= 5 and runner.stats["stopped"] == 1


def test_insights_written_once_until_enough_new_comments(session):
    seed(session)
    runner = AIRunner(session, FakeRouter(), insight_min_comments=20)
    assert runner.write_insights() == 2  # video + channel
    data, ins = latest_insight(session, "video", "v1")
    assert data["summary"] == "People liked it." and ins.comment_count == 30
    assert runner.write_insights() == 0  # nothing new
    for i in range(30, 52):  # 22 new comments (>= 20 and >= 25% growth)
        session.add(Comment(id=f"c{i}", video_id="v1", channel_id="UC1", text="new one",
                            published_at=datetime(2026, 2, 1)))
    session.commit()
    assert AIRunner(session, FakeRouter(), insight_min_comments=20).write_insights() == 1  # video only
    assert session.scalar(select(func.count()).select_from(Insight)) == 3


# ------------------------------------------------------------------ minutes budget
def test_plan_minutes_spreads_monthly_budget(session):
    now = datetime(2026, 11, 16, 0, 0)  # 15 days left -> 180 runs at 12/day
    plan = plan_minutes(session, {"MONTHLY_MINUTES_BUDGET": "1700", "RUNS_PER_DAY": "12"}, now=now)
    assert plan.used_this_month == 0
    work = plan.sync + plan.analyze + plan.ai
    assert 6 < work < 8  # 1700/180 - 2.5 overhead ~= 6.9

    # A month that is nearly used up still leaves a minimal run.
    session.add(RunLog(kind="job", started_at=datetime(2026, 11, 2),
                       finished_at=datetime(2026, 11, 2) + timedelta(minutes=1699)))
    session.commit()
    tight = plan_minutes(session, {"MONTHLY_MINUTES_BUDGET": "1700"}, now=now)
    assert tight.used_this_month == 1699
    assert tight.sync >= 1.0

    unlimited = plan_minutes(session, {"MONTHLY_MINUTES_BUDGET": "0"}, now=now)
    assert unlimited.sync + unlimited.analyze + unlimited.ai == pytest.approx(25, abs=0.2)


def test_record_job_rounds_up(session):
    import time

    record_job(session, time.time() - 61)
    from ytanalytics.budget import minutes_used_this_month

    assert minutes_used_this_month(session) == 2


def test_slow_model_is_skipped_for_the_rest_of_the_run(session):
    import requests as rq

    class SlowThenOk:
        def __init__(self):
            self.calls = []

        def post(self, url, headers=None, json=None, timeout=None):
            self.calls.append((json["model"], timeout))
            if json["model"] == "slow":
                raise rq.Timeout("read timed out")
            return ok('{"fine": true}')

    http = SlowThenOk()
    router = LLMRouter(session, [slot("slow"), slot("fast")], http=http, sleep=lambda s: None)
    assert router.chat_json("s", "u") == ({"fine": True}, "gemini/fast")
    assert router.chat_json("s", "u") == ({"fine": True}, "gemini/fast")
    assert [c[0] for c in http.calls] == ["slow", "fast", "fast"]  # slow model not retried
    assert all(c[1] <= 45 for c in http.calls)                     # never waits minutes


def test_out_of_time_is_reported_honestly(session):
    import time as t

    router = LLMRouter(session, [slot("m1")], http=FakeHTTP({"m1": []}), sleep=lambda s: None)
    with pytest.raises(NoModelAvailable, match="Out of time"):
        router.chat_json("s", "u", deadline=t.monotonic() - 1)


def test_fast_models_and_no_thinking_by_default():
    slots = slots_from_env({"GEMINI_API_KEY": "g", "GROQ_API_KEY": "q"})
    assert slots[0].key == "gemini/gemini-2.5-flash" and slots[0].extra["reasoning_effort"] == "none"
    assert [s for s in slots if s.model == "gemini-3.8-flash"][0].extra["reasoning_effort"] == "minimal"
    assert [s.key for s in slots if s.provider == "groq"][0] == "groq/openai/gpt-oss-20b"


def test_openrouter_is_a_third_free_provider():
    slots = slots_from_env({"GEMINI_API_KEY": "g", "OPENROUTER_API_KEY": "o"})
    orr = [s for s in slots if s.provider == "openrouter"]
    assert orr and all(s.model.endswith(":free") for s in orr)
    assert orr[0].base_url == "https://openrouter.ai/api/v1/"
    assert "reasoning_effort" not in orr[0].extra
    assert slots[0].provider == "gemini"  # free Gemini first, OpenRouter last


def test_quick_labels():
    from ytanalytics.quick_labels import quick_label
    assert quick_label("first!!")["sentiment"] == "neutral"
    q = quick_label("Semma anna 🔥🔥")
    assert q["sentiment"] == "positive" and q["emotion"] == "admiration" and q["lang"] == "ta-Latn"
    assert quick_label("❤️❤️❤️")["emotion"] == "love"
    assert quick_label("😭😭")["sentiment"] == "negative"
    assert quick_label("superrrr bro")["sentiment"] == "positive"
    assert quick_label("bahut accha bhai")["lang"] == "hi-Latn"
    for needs_ai in ["mokka padam", "nice?", "super but audio is bad", "😂😭", "check my channel @x", "", "bro",
                     "this video is about the new phone and its camera"]:
        assert quick_label(needs_ai) is None, needs_ai


def test_gemini_models_are_discovered_not_guessed():
    from ytanalytics.llm import pick_gemini_models
    listed = [{"name": f"models/{n}", "supportedGenerationMethods": m} for n, m in [
        ("gemini-3.5-flash", ["generateContent"]), ("gemini-3.5-flash-lite", ["generateContent"]),
        ("gemini-3.5-flash-image", ["generateContent"]), ("text-embedding-005", ["embedContent"]),
        ("gemini-3.5-pro", ["generateContent"]), ("gemini-3.6-flash-lite-preview", ["generateContent"]),
        ("gemini-3.5-flash-tts", ["generateContent"])]]
    assert pick_gemini_models(listed) == ["gemini-3.5-flash-lite", "gemini-3.6-flash-lite-preview", "gemini-3.5-flash"]


def test_new_free_providers_from_env():
    from ytanalytics.llm import slots_from_env
    slots = slots_from_env({"MISTRAL_API_KEY": "m", "CLOUDFLARE_API_KEY": "c", "CLOUDFLARE_ACCOUNT_ID": "acc1"})
    assert [s.key for s in slots] == ["mistral/mistral-small-latest", "mistral/ministral-8b-latest",
                                      "mistral/open-mistral-nemo", "cloudflare/@cf/openai/gpt-oss-20b"]
    assert slots[3].base_url == "https://api.cloudflare.com/client/v4/accounts/acc1/ai/v1/"
    assert all("reasoning_effort" not in s.extra for s in slots)
    # Cloudflare needs its account id too.
    assert slots_from_env({"CLOUDFLARE_API_KEY": "c"}) == []


def test_public_repo_gives_the_ai_lane_half_of_each_run(session):
    plan = plan_minutes(session, {"MONTHLY_MINUTES_BUDGET": "0", "MAX_WORK_MINUTES": "20"})
    assert plan.ai == 10.0 and plan.sync == 7.0 and plan.analyze == 3.0


def test_busy_model_is_skipped_with_its_reason(session):
    busy = {"message": "Service tier capacity exceeded for this model.", "code": "3505"}
    http = FakeHTTP({
        "mistral-small-latest": [Resp(429, {"error": busy}) for _ in range(4)],
        "ministral-8b-latest": [ok('{"z": 1}')],
    })
    router = LLMRouter(session, [slot("mistral-small-latest", "mistral"), slot("ministral-8b-latest", "mistral")],
                       http=http, sleep=lambda s: None)
    assert router.chat_json("s", "u") == ({"z": 1}, "mistral/ministral-8b-latest")
    assert "capacity exceeded" in router.errors["mistral/mistral-small-latest"]
    # Not marked as used up for the day: a temporary problem, so the next run tries it again.
    assert not session.scalars(select(LlmUsage).where(LlmUsage.model_key == "mistral/mistral-small-latest")).one().exhausted


def test_several_keys_and_new_free_providers():
    from ytanalytics.llm import slots_from_env, split_keys
    assert split_keys(" a, b\nc ,") == ["a", "b", "c"]
    env = {"MISTRAL_API_KEY": "k1,k2", "MISTRAL_MODELS": "m", "GITHUB_MODELS_API_KEY": "ghs_x", "GITHUB_MODELS_MODELS": "openai/gpt-4.1-mini",
           "NVIDIA_API_KEY": "nv", "NVIDIA_MODELS": "meta/llama-3.3-70b-instruct", "AI_PROVIDER_ORDER": "mistral,github,nvidia"}
    slots = slots_from_env(env)
    assert [(s.provider, s.api_key) for s in slots] == [("mistral", "k1"), ("mistral#2", "k2"), ("github", "ghs_x"), ("nvidia", "nv")]
    assert len({s.key for s in slots}) == len(slots)  # each key has its own daily count
    assert slots[2].base_url == "https://models.github.ai/inference/" and not slots[2].extra  # no reasoning parameter


def test_local_model_is_opt_in_and_last():
    assert not any(s.key.startswith("local/") for s in slots_from_env({"GEMINI_API_KEY": "g"}))
    slots = slots_from_env({"GEMINI_API_KEY": "g", "GEMINI_MODELS": "a", "LOCAL_LLM_API_KEY": "x",
                            "LOCAL_LLM_BASE_URL": "http://box:8080/v1/"})
    assert slots[-1].key == "local/local" and slots[-1].base_url == "http://box:8080/v1/"
    assert "reasoning_effort" not in slots[-1].extra
