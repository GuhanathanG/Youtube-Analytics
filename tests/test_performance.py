"""Guards against the slow-database problem: the production database (Supabase, Sydney)
is ~0.2 s away from GitHub's US runners, so every query counts. These tests count
round trips instead of timing them."""
import os
from datetime import timedelta

import pytest


@pytest.fixture(autouse=True)
def full_history(monkeypatch):
    monkeypatch.setenv("HISTORY_DAYS", "36500")  # these tests download a whole (past-dated) history
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


def test_big_channel_gets_comments_in_the_first_run(engine):
    """A channel with 1,200 videos: the first run must not spend itself on the video list."""
    settings = Settings.from_env()
    settings.max_run_minutes = 5
    with make_session_factory(engine)() as s:
        yt = FakeYouTube(QuotaTracker(s, 10_000))
        yt.add_channel(CID, "@perf", n_videos=1200, comments_per_video=0)
        newest = yt.uploads["UU" + CID[2:]][:2]
        for vid in newest:
            for j in range(50):
                yt.post_comment(vid, BASE + timedelta(minutes=j))
        s.add(ChannelRequest(query="@perf"))
        s.commit()
        stats = run_sync(s, settings, yt=yt)
        assert stats.videos_discovered == 200          # 4 pages of history this run
        assert stats.comments_saved == 100             # and the newest videos' comments
        # Later runs continue the video list where they stopped, and pick up new uploads.
        for _ in range(6):
            run_sync(s, settings, yt=yt)
        assert s.scalar(select(func.count()).select_from(Video)) == 1200


def test_new_upload_seen_while_history_is_still_being_walked(engine):
    settings = Settings.from_env()
    settings.max_run_minutes = 5
    with make_session_factory(engine)() as s:
        yt = FakeYouTube(QuotaTracker(s, 10_000))
        yt.add_channel(CID, "@perf", n_videos=600)
        s.add(ChannelRequest(query="@perf"))
        s.commit()
        run_sync(s, settings, yt=yt)
        playlist = "UU" + CID[2:]
        yt.videos["brandnew001"] = {"id": "brandnew001", "snippet": {"title": "New!", "publishedAt": "2026-06-01T00:00:00Z", "thumbnails": {}},
                                    "statistics": {"viewCount": "1", "likeCount": "0", "commentCount": "0"}, "contentDetails": {}}
        yt.threads["brandnew001"] = []
        yt.uploads[playlist].insert(0, "brandnew001")
        run_sync(s, settings, yt=yt)
        assert s.get(Video, "brandnew001") is not None
