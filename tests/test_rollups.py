"""Running totals stay exactly equal to counting the comments themselves, through every kind of change."""
import os
from datetime import timedelta

import pytest
from sqlalchemy import text

from ytanalytics.config import normalize_db_url
from ytanalytics.db import Base, Channel, Comment, Video, init_db, make_engine, make_session_factory, utcnow
from ytanalytics.rollups import ensure_rollups

URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL.startswith("postgres"), reason="needs Postgres (TEST_DATABASE_URL)")


@pytest.fixture
def engine():
    eng = make_engine(normalize_db_url(URL))
    Base.metadata.drop_all(eng)
    init_db(eng)
    yield eng
    eng.dispose()


def totals(conn):
    """Each rollup next to the same numbers counted from the comments (must be identical)."""
    q = lambda s: [tuple(r) for r in conn.execute(text(s)).all()]  # noqa: E731
    return {
        "day": (q("""select channel_id, day, comments, positive, neutral, negative, pending, analyzed, ai_read, spam, questions,
                     requests, likes, round(sent_sum::numeric, 6), sent_n from comment_day where comments <> 0 order by 1, 2"""),
                q("""select channel_id, date(published_at), count(*), count(*) filter (where sentiment = 'positive'),
                     count(*) filter (where sentiment = 'neutral'), count(*) filter (where sentiment = 'negative'),
                     count(*) filter (where sentiment is null), count(analyzed_at), count(ai_at), count(*) filter (where is_spam),
                     count(*) filter (where is_question), count(*) filter (where is_suggestion), coalesce(sum(like_count), 0),
                     round(coalesce(sum(sentiment_value), 0)::numeric, 6), count(sentiment_value)
                     from comments where published_at is not null group by 1, 2 order by 1, 2""")),
        "video": (q("select video_id, comments, positive, negative, likes, sent_n from comment_video where comments <> 0 order by 1"),
                  q("""select video_id, count(*), count(*) filter (where sentiment = 'positive'), count(*) filter (where sentiment = 'negative'),
                       coalesce(sum(like_count), 0), count(sentiment_value) from comments group by 1 order by 1""")),
    }


def assert_exact(engine):
    with engine.connect() as conn:
        for name, (rollup, counted) in totals(conn).items():
            assert rollup == counted, name


def test_running_totals_follow_every_change(engine):
    S = make_session_factory(engine)
    now = utcnow()
    with S() as s:
        s.add_all([Channel(id="UC1", title="A", active=True), Channel(id="UC2", title="B", active=True)])
        s.add_all([Video(id="v1", channel_id="UC1", title="t"), Video(id="v2", channel_id="UC2", title="u")])
        s.commit()
        # Comments that exist before the totals are built: the one-time fill must count them.
        s.add_all([Comment(id=f"old{i}", video_id="v1", channel_id="UC1", text="x", like_count=i, author_channel_id=f"fan{i % 3}",
                           published_at=now - timedelta(days=i % 4)) for i in range(12)])
        s.commit()
    assert ensure_rollups(engine) is True
    assert ensure_rollups(engine) is False  # second time: nothing to do
    assert_exact(engine)

    with S() as s:
        # New comments (one statement with many rows, like the worker's batch insert)
        s.add_all([Comment(id=f"new{i}", video_id="v2", channel_id="UC2", text="y", like_count=1, author_channel_id="fanX",
                           published_at=now - timedelta(hours=i)) for i in range(5)])
        s.commit()
        assert_exact(engine)
        # The sentiment model and the AI label them (updates), one gets flagged as spam, likes change
        s.execute(text("update comments set sentiment = 'positive', sentiment_value = 0.7, analyzed_at = now(), language = 'ta'"
                       " where id like 'old%'"))
        s.execute(text("update comments set sentiment = 'negative', sentiment_value = -0.5, ai_at = now(), emotion = 'anger',"
                       " is_question = true where id = 'new1'"))
        s.execute(text("update comments set is_spam = true, is_suggestion = true where id = 'old3'"))
        s.execute(text("update comments set like_count = like_count + 10 where channel_id = 'UC1'"))
        s.execute(text("update comments set translation = 'only text changed' where id = 'new2'"))
        s.commit()
        assert_exact(engine)
        # Archiving deletes comments
        s.execute(text("delete from comments where id in ('old0', 'old5', 'new4')"))
        s.commit()
        assert_exact(engine)
        # A video removed with all its comments (cascade)
        s.execute(text("delete from videos where id = 'v2'"))
        s.commit()
        assert_exact(engine)
