"""Reading archived comments in place: local pass, AI pass, rebuilt daily totals and progress (needs PostgreSQL)."""
import os
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from ytanalytics.archive import ARCHIVE_TABLE, MAIN_TABLES
from ytanalytics.archive_ai import read_archive
from ytanalytics.config import normalize_db_url
from ytanalytics.db import Base, Channel, Video, init_db, make_engine, make_session_factory

PG = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not PG.startswith("postgres"), reason="needs PostgreSQL (TEST_DATABASE_URL)")


def _fresh_db(name: str) -> str:
    base = create_engine(normalize_db_url(PG), isolation_level="AUTOCOMMIT")
    with base.connect() as c:
        c.execute(text(f"drop database if exists {name}"))
        c.execute(text(f"create database {name}"))
    base.dispose()
    return PG.rsplit("/", 1)[0] + "/" + name


class Mood:
    name = "test-head"

    def __call__(self, texts):
        return [{"positive": 0.9, "neutral": 0.05, "negative": 0.05} if "semma" in t else
                {"positive": 0.05, "neutral": 0.1, "negative": 0.85} for t in texts]


class FakeRouter:
    def __init__(self):
        self.calls = 0

    def chat_json(self, system, user, max_tokens=0, deadline=None):
        self.calls += 1
        n = sum(1 for line in user.splitlines() if line[:1].isdigit())
        return {"results": [{"i": i, "sentiment": "positive", "score": 0.8, "emotion": "joy", "question": False,
                             "suggestion": True, "spam": False, "toxic": False, "aspects": [{"a": "audio", "s": "neg"}],
                             "lang": "ta-Latn", "en": "great video"} for i in range(1, n + 1)]}, "mistral/test"


@pytest.fixture
def dbs(monkeypatch):
    main_url, arch_url = _fresh_db("yta_main_t"), _fresh_db("yta_arch_t")
    engine = make_engine(normalize_db_url(main_url))
    Base.metadata.drop_all(engine)
    init_db(engine)
    s = make_session_factory(engine)()
    s.add(Channel(id="UCx", title="X", active=True))
    s.add(Video(id="v1", channel_id="UCx", title="Phone review", published_at=datetime(2026, 1, 1)))
    s.commit()
    for stmt in MAIN_TABLES.strip().split(";"):
        if stmt.strip():
            s.execute(text(stmt))
    s.commit()
    s.execute(text("create table if not exists panel_cache (key text primary key, data text not null, computed_at timestamp not null, ms integer)"))
    for k in ("ch:UCx:all:mix", "overview:all:daily", "kw:other"):
        s.execute(text("insert into panel_cache values (:k, '{}', now() at time zone 'utc', 1)"), {"k": k})
    s.commit()
    arch = create_engine(normalize_db_url(arch_url))
    with arch.begin() as c:
        for stmt in ARCHIVE_TABLE.strip().split(";"):
            if stmt.strip():
                c.execute(text(stmt))
        for i in range(120):
            c.execute(text("""insert into comments (id, video_id, channel_id, text, like_count, published_at)
                values (:id, 'v1', 'UCx', :t, :l, :p)"""), {"id": f"a{i}", "t": ("semma video anna " if i % 2 else "mokka audio bro ") + str(i) * 30,
                                                          "l": i, "p": datetime(2026, 1, 1) + timedelta(days=i % 3)})
    monkeypatch.setenv("ARCHIVE_DATABASE_URL", arch_url)
    yield s, arch
    s.close()
    engine.dispose()
    arch.dispose()


def test_archive_gets_the_same_reading(dbs):
    import time

    s, arch = dbs
    router = FakeRouter()
    out = read_archive(s, time.time() + 120, classifier=Mood(), router=router)
    assert out["local"] == 120 and out["ai"] == 120 and router.calls == 3  # 40 a batch
    with arch.connect() as c:
        left = c.execute(text("select count(*) filter (where analyzed_at is null), count(*) filter (where ai_at is null) from comments")).one()
        row = c.execute(text("select sentiment, sentiment_source, emotion, is_suggestion, aspects, translation, ai_model from comments where id = 'a119'")).one()
    assert tuple(left) == (0, 0)
    assert row.sentiment == "positive" and row.sentiment_source == "ai" and row.emotion == "joy" and row.is_suggestion
    assert row.aspects == "audio:neg" and row.translation == "great video" and row.ai_model == "mistral/test"
    stats = s.execute(text("select sum(comments), sum(positive), sum(analyzed), sum(ai_read) from archive_stats where channel_id = 'UCx'")).one()
    assert tuple(stats) == (120, 120, 120, 120)
    prog = s.execute(text("select comments, analyzed, ai_read from archive_progress where channel_id = 'UCx'")).one()
    assert tuple(prog) == (120, 120, 120)
    # The channel's saved page sections were marked for refresh (pages follow the new totals).
    ages = dict(s.execute(text("select key, extract(epoch from (now() at time zone 'utc') - computed_at) / 86400 from panel_cache")).all())
    assert ages["ch:UCx:all:mix"] > 20 and ages["overview:all:daily"] > 20 and ages["kw:other"] < 1


def test_local_pass_alone_and_live_backlog_pauses_ai(dbs):
    import time

    s, arch = dbs
    out = read_archive(s, time.time() + 120, classifier=Mood(), router=FakeRouter(), do_ai=False)
    assert out["local"] == 120 and out["ai"] == 0
    stats = s.execute(text("select sum(positive), sum(negative) from archive_stats")).one()
    assert tuple(stats) == (60, 60)
    # 300 new comments waiting for the AI: the archive's AI pass waits (new comments come first).
    for i in range(300):
        s.execute(text("insert into comments (id, video_id, channel_id, text, like_count, reply_count, fetched_at) values (:i, 'v1', 'UCx', 'new', 0, 0, now())"), {"i": f"n{i}"})
    s.commit()
    router = FakeRouter()
    assert read_archive(s, time.time() + 3, classifier=Mood(), router=router, do_local=False)["ai"] == 0 and router.calls == 0
