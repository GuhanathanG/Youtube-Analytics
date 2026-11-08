import os
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, text

from ytanalytics.archive import archive_old_comments, should_archive
from ytanalytics.config import normalize_db_url
from ytanalytics.db import Base, Channel, Comment, Video, init_db, make_engine, make_session_factory, utcnow


@pytest.fixture
def session():
    engine = make_engine(normalize_db_url(os.environ.get("TEST_DATABASE_URL", "sqlite://")))
    Base.metadata.drop_all(engine)
    with engine.begin() as c:
        c.execute(text("drop table if exists archive_stats"))
    init_db(engine)
    with make_session_factory(engine)() as s:
        yield s
    engine.dispose()


def test_old_read_comments_move_and_counts_stay(session, tmp_path):
    old, new = utcnow() - timedelta(days=400), utcnow() - timedelta(days=5)
    session.add(Channel(id="UC1", title="C", active=True))
    session.add(Video(id="v1", channel_id="UC1", title="t"))
    session.commit()
    rows = [
        ("a1", old, True, 1, False, "positive", 0.8),   # moves
        ("a2", old, True, 2, False, "negative", -0.6),  # moves
        ("keep-liked", old, True, 90, False, "positive", 0.9),   # 25+ likes: stays
        ("keep-question", old, True, 1, True, "neutral", 0.0),   # a question: stays
        ("keep-unread", old, False, 1, False, None, None),       # AI hasn't read it: stays
        ("keep-new", new, True, 1, False, "positive", 0.5),      # recent: stays
    ]
    for cid, when, read, likes, q, sent, val in rows:
        session.add(Comment(id=cid, video_id="v1", channel_id="UC1", text=cid, like_count=likes, published_at=when,
                            analyzed_at=utcnow(), ai_at=utcnow() if read else None, is_question=q, sentiment=sent, sentiment_value=val))
    session.commit()
    archive_url = f"sqlite:///{tmp_path / 'archive.db'}"
    # Strict mode: only comments the AI has already read move.
    os.environ["ARCHIVE_NEEDS_AI"] = "1"
    try:
        assert archive_old_comments(session, archive_url, batch=1) == 2
    finally:
        del os.environ["ARCHIVE_NEEDS_AI"]
    left = {r[0] for r in session.execute(text("select id from comments"))}
    assert left == {"keep-liked", "keep-question", "keep-unread", "keep-new"}
    arch = create_engine(archive_url)
    with arch.connect() as c:
        assert {r[0] for r in c.execute(text("select id from comments"))} == {"a1", "a2"}
    st = session.execute(text("select sum(comments), sum(positive), sum(negative), sum(ai_read) from archive_stats where channel_id = 'UC1'")).one()
    assert tuple(st) == (2, 1, 1, 2)
    assert session.execute(text("select archived_comments from videos where id = 'v1'")).scalar() == 2
    # Running again moves nothing new and never double-counts.
    os.environ["ARCHIVE_NEEDS_AI"] = "1"
    try:
        assert archive_old_comments(session, archive_url) == 0
    finally:
        del os.environ["ARCHIVE_NEEDS_AI"]
    assert session.execute(text("select sum(comments) from archive_stats")).scalar() == 2
    # Default: old comments move even before the AI reads them (the main database stays small);
    # their counts still land in archive_stats (as not yet analysed).
    assert archive_old_comments(session, archive_url) == 1
    assert {r[0] for r in session.execute(text("select id from comments"))} == {"keep-liked", "keep-question", "keep-new"}
    assert session.execute(text("select sum(comments) from archive_stats")).scalar() == 3


def test_several_archive_databases(session, tmp_path):
    from ytanalytics.archive import archive_urls, pick_shard
    one, two = f"sqlite:///{tmp_path / 'a1.db'}", f"sqlite:///{tmp_path / 'a2.db'}"
    env = {"ARCHIVE_DATABASE_URLS": f"{one}, {two}", "ARCHIVE_DATABASE_URL": one}
    assert archive_urls(None, env) == [one, two]  # listed once, in order
    assert pick_shard([one, two]) is not None
    assert pick_shard([one, two], limit_mb=-1) is None  # all full


def test_archive_only_when_needed(session):
    assert should_archive(session, {})[0] is False  # no archive database configured
    assert should_archive(session, {"ARCHIVE_DATABASE_URL": "x", "ARCHIVE_FORCE": "1"})[0] is True
