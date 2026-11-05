"""Guards against the slow-database problem: the production database (Supabase, Sydney)
is ~0.2 s away from GitHub's US runners, so every query counts. These tests count
round trips instead of timing them."""
import os
from datetime import timedelta

import pytest
from sqlalchemy import event, func, select

from tests.fakes import BASE, FakeYouTube
from ytanalytics.config import Settings, normalize_db_url
from ytanalytics.db import Base, ChannelRequest, Comment, Video, init_db, make_engine, make_session_factory
from ytanalytics.sync import run_sync
from ytanalytics.youtube import QuotaTracker

CID = "UC" + "p" * 18 + "perf"


class Counter:
    def __init__(self, engine):
        self.n = 0
        event.listen(engine, "before_cursor_execute", self._hit)

    def _hit(self, *args, **kwargs):
        self.n += 1


@pytest.fixture
def engine():
    eng = make_engine(normalize_db_url(os.environ.get("TEST_DATABASE_URL", "sqlite://")))
    Base.metadata.drop_all(eng)
    init_db(eng)
    yield eng
    eng.dispose()


def test_startup_check_is_one_query_when_schema_is_current(engine):
    counter = Counter(engine)
    init_db(engine)
    assert counter.n == 1


def test_discovering_150_videos_takes_few_queries(engine):
    settings = Settings.from_env()
    settings.max_run_minutes = 5
    with make_session_factory(engine)() as s:
        yt = FakeYouTube(QuotaTracker(s, 10_000))
        yt.add_channel(CID, "@perf", n_videos=150, comments_per_video=0)
        s.add(ChannelRequest(query="@perf"))
        s.commit()
        counter = Counter(engine)
        stats = run_sync(s, settings, yt=yt)
        assert stats.videos_discovered == 150
        # The old per-row code needed ~500 queries for this; bulk writes need a few per page.
        assert counter.n < 80, f"{counter.n} queries for 150 videos"


def test_comments_are_reached_in_the_same_run_as_video_discovery(engine):
    settings = Settings.from_env()
    settings.max_run_minutes = 5
    with make_session_factory(engine)() as s:
        yt = FakeYouTube(QuotaTracker(s, 10_000))
        yt.add_channel(CID, "@perf", n_videos=150, comments_per_video=0)
        for vid in yt.uploads["UU" + CID[2:]][:3]:
            for j in range(120):
                yt.post_comment(vid, BASE + timedelta(minutes=j))
        s.add(ChannelRequest(query="@perf"))
        s.commit()
        counter = Counter(engine)
        stats = run_sync(s, settings, yt=yt)
        assert stats.comments_saved == 360
        assert s.scalar(select(func.count()).select_from(Comment)) == 360
        assert s.scalar(select(func.count()).select_from(Video).where(Video.comments_backfilled.is_(False))) == 0
        # 6 comment pages + 150 empty videos: should stay well under one query per video
        assert counter.n < 600, f"{counter.n} queries"
