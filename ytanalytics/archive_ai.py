"""Read the archived (older) comments like every new one, inside the archive databases.

Older comments moved to the archive before the AI had read them. Two passes, both writing straight into the archive:

1. Local pass (free, no limits, ~1-2 hours for a million): rule labels for short reactions; mood from our own
   Tanglish model (or the default model); language; question / request flags.
2. AI pass (the same reading new comments get: mood, emotion, intent, spam, toxicity, aspects, translation), using
   the free cloud models EXCEPT Gemini by default (ARCHIVE_AI_PROVIDERS), so the website keeps its own Gemini
   allowance. Most-liked comments first. Resumes where it stopped; runs only while new comments are all read.

After each pass the archive's daily totals (archive_stats, in the main database) are rebuilt for the days that
changed, so mood charts and totals include the old comments. Writes go in batches with a VACUUM in between, so a
million rewritten rows don't double the archive's size.
"""
from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from .archive import archive_urls
from .config import normalize_db_url
from .quick_labels import quick_label
from .sentiment import _clean, detect_language, summarize_probs

log = logging.getLogger(__name__)

AI_COLS = ["sentiment", "sentiment_value", "sentiment_score", "sentiment_source", "analyzed_at", "analyzer", "emotion",
           "is_question", "is_suggestion", "is_spam", "is_toxic", "aspects", "translation", "ai_at", "ai_model", "language"]


def _shard_sql(shard: tuple[int, int] | None) -> str:
    """Parallel readers split the comments by id, so no two read the same one."""
    if not shard or shard[1] <= 1:
        return ""
    k, n = int(shard[0]), int(shard[1])
    return f" and mod(abs(hashtext(id)), {n}) = {k}"


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def _indexes(engine) -> None:
    """Partial indexes so 'what's left to read' is instant (built without blocking)."""
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        for name, spec in (("ix_archive_unanalyzed", "on comments (like_count desc nulls last) where analyzed_at is null"),
                           ("ix_archive_ai_next", "on comments (like_count desc nulls last) where ai_at is null")):
            try:
                c.execute(text(f"create index concurrently if not exists {name} {spec}"))
            except Exception as e:
                log.warning("index %s not built: %s", name, str(e).splitlines()[0])


def _apply(engine, rows: list[dict]) -> None:
    """One UPDATE for a whole batch (one round trip to a far-away archive)."""
    if not rows:
        return
    cols = [c for c in AI_COLS if any(c in r for r in rows)]
    payload = json.dumps([{k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in r.items()} for r in rows])
    types = {"sentiment_value": "double precision", "sentiment_score": "double precision", "analyzed_at": "timestamp",
             "ai_at": "timestamp", "is_question": "boolean", "is_suggestion": "boolean", "is_spam": "boolean", "is_toxic": "boolean"}
    sets = ", ".join(f"{c} = coalesce((j->>'{c}')::{types.get(c, 'text')}, a.{c})" for c in cols)
    with engine.begin() as conn:
        conn.execute(text(f"""update comments a set {sets}
            from jsonb_array_elements(cast(:p as jsonb)) j where a.id = j->>'id'"""), {"p": payload})


def _vacuum(engine) -> None:
    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
            c.execute(text("vacuum comments"))
    except Exception as e:
        log.warning("vacuum skipped: %s", str(e).splitlines()[0])


def local_pass(engine, classifier, deadline: float, batch: int = 1000, touched: set | None = None) -> int:
    """Mood, language, question/request for archived comments with no mood yet."""
    from .local_ai import detect_question_request

    done, since_vacuum = 0, 0
    while time.monotonic() < deadline:
        with engine.connect() as c:
            rows = c.execute(text("""select id, channel_id, published_at::date as day, text from comments
                where analyzed_at is null order by like_count desc nulls last limit :n"""), {"n": batch}).all()
        if not rows:
            break
        now = _now()
        out, need_model = [], []
        for r in rows:
            q = quick_label(r.text) if len(r.text or "") <= 60 else None
            if q:
                out.append({"id": r.id, "sentiment": q["sentiment"], "sentiment_value": q["score"],
                            "sentiment_score": abs(q["score"]) if q["sentiment"] != "neutral" else 1.0,
                            "sentiment_source": "rules", "analyzed_at": now, "analyzer": "rules", "emotion": q["emotion"],
                            "language": q["lang"] or detect_language(r.text)})
            else:
                need_model.append(r)
        if need_model:
            probs = classifier([_clean(r.text) for r in need_model])
            for r, p in zip(need_model, probs):
                label, conf, value = summarize_probs(p)
                is_q, is_s = detect_question_request(r.text)
                out.append({"id": r.id, "sentiment": label, "sentiment_score": round(conf, 4), "sentiment_value": round(value, 4),
                            "sentiment_source": "model", "analyzed_at": now, "analyzer": classifier.name,
                            "language": detect_language(r.text), "is_question": is_q, "is_suggestion": is_s})
        _apply(engine, out)
        if touched is not None:
            touched.update((r.channel_id, r.day) for r in rows)
        done += len(rows)
        since_vacuum += len(rows)
        if since_vacuum >= 50_000:
            _vacuum(engine)
            since_vacuum = 0
        log.info("archive local pass: %d", done)
    return done


def ai_pass(engine, router, titles, deadline: float, batch: int | None = None, touched: set | None = None,
            should_continue=lambda: True, shard: tuple[int, int] | None = None) -> int:
    """The full AI reading for archived comments, most-liked first."""
    from .ai import COMMENT_SYSTEM, _comment_update
    from .llm import NoModelAvailable

    batch = batch or int(os.environ.get("ARCHIVE_AI_BATCH", "30"))
    done, since_vacuum, empty, idle, last_reset = 0, 0, 0, 0, time.monotonic()
    limit_mb = float(os.environ.get("ARCHIVE_DB_LIMIT_MB", "1000")) * 0.9
    while time.monotonic() < deadline:
        if not should_continue():  # new comments are waiting: let them go first, then carry on
            log.info("archive AI pass: new comments waiting in the main database; trying again in 2 minutes")
            time.sleep(min(120.0, max(0.0, deadline - time.monotonic())))
            continue
        if done % 2000 < batch:  # now and then: never fill the free archive database
            with engine.connect() as c:
                mb = float(c.execute(text("select pg_database_size(current_database())")).scalar() or 0) / 1048576
            if mb > limit_mb:
                log.warning("archive AI pass stopped: this archive is %.0f MB (limit %.0f MB)", mb, limit_mb)
                break
        with engine.connect() as c:
            rows = c.execute(text("""select id, channel_id, video_id, published_at::date as day, text from comments
                where ai_at is null""" + _shard_sql(shard) + """ order by like_count desc nulls last limit :n"""), {"n": batch}).all()
        if not rows:
            break
        vids = list(dict.fromkeys(r.video_id for r in rows))
        nums = {v: i for i, v in enumerate(vids, start=1)}
        lines = ["Videos:"] + [f"V{nums[v]}: {titles(v)}" for v in vids] + ["\nComments:"]
        lines += [f"{i}. [V{nums[r.video_id]}] {' '.join((r.text or '').split())[:500]}" for i, r in enumerate(rows, start=1)]
        try:
            data, model = router.chat_json(COMMENT_SYSTEM, "\n".join(lines), max_tokens=min(16000, 1000 + 130 * len(rows)),
                                           deadline=deadline)
        except NoModelAvailable as e:
            # Long run: a model that was slow once or busy for a few minutes gets another chance. Stop only when every
            # model's daily allowance is used up, or nothing has answered for ~10 minutes.
            if "used up for today" in str(e) or time.monotonic() > deadline - 60:
                log.info("archive AI pass stopped: %s", e)
                break
            idle += 1
            if idle > int(os.environ.get("ARCHIVE_AI_IDLE_TRIES", "10")):
                log.info("archive AI pass stopped: no model answered for %d minutes (%s)", idle - 1, e)
                break
            _retry_busy(router)
            log.info("archive AI pass: every model busy (%s); trying again in a minute", str(e)[:200])
            time.sleep(min(60.0, max(0.0, deadline - time.monotonic())))
            continue
        idle = 0
        if time.monotonic() - last_reset > 900:  # every 15 min, give models skipped as "busy" a fresh try
            _retry_busy(router)
            last_reset = time.monotonic()
        results = {}
        for item in data.get("results") or []:
            try:
                results[int(item.get("i"))] = item
            except (TypeError, ValueError):
                continue
        if not results:
            empty += 1
            if empty >= 3:
                break
            continue
        now = _now()
        updates = [_comment_update(r.id, results[i], now, model) for i, r in enumerate(rows, start=1) if i in results]
        _apply(engine, updates)
        if touched is not None:
            touched.update((r.channel_id, r.day) for r in rows)
        done += len(updates)
        since_vacuum += len(updates)
        if since_vacuum >= 20_000:
            _vacuum(engine)
            since_vacuum = 0
        log.info("archive AI pass: %d (%s)", done, model)
    return done


def _retry_busy(router) -> None:
    """Forget per-run skips that were temporary (too slow, rate limited); keep rejected keys skipped."""
    errors = getattr(router, "errors", None)
    if isinstance(errors, dict):
        for k in [k for k, v in errors.items() if not str(v).startswith("API key rejected")]:
            errors.pop(k, None)


def rebuild_stats(session: Session, engines: list, touched: set) -> int:
    """Re-total archive_stats (main database) for the (channel, day) pairs that changed, across every archive."""
    if not touched:
        return 0
    keys = sorted(touched)
    totals: dict = defaultdict(lambda: [0, 0, 0, 0, 0.0, 0, 0, 0])
    for eng in engines:
        for i in range(0, len(keys), 500):
            chunk = keys[i:i + 500]
            payload = json.dumps([{"c": c, "d": d.isoformat()} for c, d in chunk])
            with eng.connect() as conn:
                rows = conn.execute(text("""select a.channel_id, a.published_at::date as day, count(*) n,
                    count(*) filter (where sentiment = 'positive') pos, count(*) filter (where sentiment = 'neutral') neu,
                    count(*) filter (where sentiment = 'negative') neg, coalesce(sum(sentiment_value), 0) s,
                    count(sentiment_value) sn, count(analyzed_at) an, count(ai_at) ai
                    from comments a join jsonb_array_elements(cast(:p as jsonb)) k
                      on a.channel_id = k->>'c' and a.published_at::date = (k->>'d')::date
                    group by 1, 2"""), {"p": payload}).all()
            for r in rows:
                t = totals[(r.channel_id, r.day)]
                for j, v in enumerate((r.n, r.pos, r.neu, r.neg, float(r.s), r.sn, r.an, r.ai)):
                    t[j] += v
    if totals:  # the archive's totals changed: pages built on them refresh
        from .freshness import mark_stale

        mark_stale(session, channel_ids=sorted({c for c, _ in totals}), patterns=["overview:%"])
    for (c, d), t in totals.items():
        session.execute(text("""insert into archive_stats (channel_id, day, comments, positive, neutral, negative, sentiment_sum,
                sentiment_n, analyzed, ai_read) values (:c, :d, :n, :p, :u, :g, :s, :sn, :an, :ai)
            on conflict (channel_id, day) do update set comments = excluded.comments, positive = excluded.positive,
              neutral = excluded.neutral, negative = excluded.negative, sentiment_sum = excluded.sentiment_sum,
              sentiment_n = excluded.sentiment_n, analyzed = excluded.analyzed, ai_read = excluded.ai_read"""),
                        {"c": c, "d": d, "n": t[0], "p": t[1], "u": t[2], "g": t[3], "s": t[4], "sn": t[5], "an": t[6], "ai": t[7]})
    session.commit()
    return len(totals)


def save_progress(session: Session, engines: list) -> None:
    """Per channel: archived comments, how many have a mood, how many the AI has read (for the Jobs panel)."""
    session.execute(text("""create table if not exists archive_progress (channel_id text primary key, comments integer,
        analyzed integer, ai_read integer, updated_at timestamp, prev_analyzed integer, prev_ai_read integer, prev_at timestamp)"""))
    agg: dict = defaultdict(lambda: [0, 0, 0])
    for eng in engines:
        with eng.connect() as conn:
            for r in conn.execute(text("""select channel_id, count(*) n, count(analyzed_at) an, count(ai_at) ai
                    from comments group by 1""")).all():
                a = agg[r.channel_id]
                a[0] += r.n; a[1] += r.an; a[2] += r.ai
    for c, (n, an, ai) in agg.items():
        session.execute(text("""insert into archive_progress (channel_id, comments, analyzed, ai_read, updated_at)
            values (:c, :n, :an, :ai, :t) on conflict (channel_id) do update set comments = excluded.comments,
            prev_analyzed = archive_progress.analyzed, prev_ai_read = archive_progress.ai_read, prev_at = archive_progress.updated_at,
            analyzed = excluded.analyzed, ai_read = excluded.ai_read, updated_at = excluded.updated_at"""),
                        {"c": c, "n": n, "an": an, "ai": ai, "t": _now()})
    session.commit()


def read_archive(session: Session, until: float, classifier=None, router=None, do_local: bool = True, do_ai: bool = True,
                 shard: tuple[int, int] | None = None) -> dict:
    """Both passes over every archive database until `until` (time.time()). Returns counts."""
    urls = archive_urls(session)
    if not urls:
        return {"skipped": "no archive database"}
    engines = [create_engine(normalize_db_url(u), pool_pre_ping=True) for u in urls]
    for e in engines:
        _indexes(e)
    deadline = time.monotonic() + max(0.0, until - time.time())
    out = {"local": 0, "ai": 0}
    touched: set = set()

    if do_local:
        if classifier is None:
            from .tanglish import load_head

            classifier = load_head(session)
            if classifier is None:
                from .config import Settings
                from .sentiment import HFClassifier

                classifier = HFClassifier(Settings.from_env().sentiment_model)
        for e in engines:
            out["local"] += local_pass(e, classifier, deadline, touched=touched)
        rebuild_stats(session, engines, touched)
        touched.clear()

    if do_ai:
        if router is None:
            from .llm import LLMRouter, slots_from_env

            env = dict(os.environ)
            env["AI_PROVIDER_ORDER"] = os.environ.get("ARCHIVE_AI_PROVIDERS",
                                                      "mistral,github,cloudflare,groq,sambanova,nvidia,openrouter")
            slots = slots_from_env(env)
            # Its own Gemini key (a separate Google project = its own free allowance): used first, under its own usage
            # counters ("gemini-archive/..."), so the website's Gemini allowance is never touched.
            own = os.environ.get("ARCHIVE_GEMINI_API_KEY", "").strip()
            if own:
                genv = {"GEMINI_API_KEY": own, "AI_PROVIDER_ORDER": "gemini",
                        "GEMINI_MODELS": os.environ.get("ARCHIVE_GEMINI_MODELS",
                                                        "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest"),
                        "GEMINI_DAILY_REQUESTS": os.environ.get("ARCHIVE_GEMINI_DAILY_REQUESTS", "900")}
                gslots = slots_from_env(genv)
                for g in gslots:
                    g.provider = g.provider.replace("gemini", "gemini-archive", 1)
                slots = gslots + slots
            log.info("archive AI pass: %d models available (%s)", len(slots), ", ".join(sorted({x.key.split("/")[0] for x in slots})) or "none")
            router = LLMRouter(session, slots) if slots else None
        if router is not None:
            cache: dict[str, str] = {}

            def titles(vid: str) -> str:
                if vid not in cache:
                    cache[vid] = session.execute(text("select title from videos where id = :v"), {"v": vid}).scalar() or ""
                return cache[vid]

            def live_caught_up() -> bool:  # new comments always come first
                return (session.execute(text("select count(*) from comments where ai_at is null")).scalar() or 0) < 200

            per_db = max(60.0, (deadline - time.monotonic()) / max(1, len(engines)))
            for e in engines:
                out["ai"] += ai_pass(e, router, titles, min(deadline, time.monotonic() + per_db), touched=touched,
                                     should_continue=live_caught_up, shard=shard)
            rebuild_stats(session, engines, touched)
        else:
            out["ai_skipped"] = "no non-Gemini AI keys on this worker"
            log.warning("archive AI pass skipped: no AI keys other than Gemini on this worker (ARCHIVE_AI_PROVIDERS)")
    save_progress(session, engines)
    for e in engines:
        e.dispose()
    return out
