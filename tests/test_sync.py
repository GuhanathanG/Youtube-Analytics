import os
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from tests.fakes import BASE, FakeYouTube
from ytanalytics.config import Settings, normalize_db_url
from ytanalytics.db import (
    Base, Channel, ChannelRequest, Comment, QuotaUsage, Video, init_db, make_engine, make_session_factory,
)
from ytanalytics.sync import Syncer, run_sync
from ytanalytics.youtube import QuotaTracker, parse_channel_query

CID = "UC" + "a" * 18 + "chan"   # 24 chars
CID2 = "UC" + "b" * 18 + "beta"


@pytest.fixture(autouse=True)
def full_history(monkeypatch):
    # These tests cover downloading a channel's whole history (fake videos are dated in the past).
    monkeypatch.setenv("HISTORY_DAYS", "36500")


@pytest.fixture
def settings():
    s = Settings.from_env()
    s.database_url = "sqlite://"
    s.daily_quota = 10_000
    s.max_run_minutes = 5
    return s


@pytest.fixture
def session(settings):
    # Set TEST_DATABASE_URL=postgresql://... to run the same tests against PostgreSQL.
    engine = make_engine(normalize_db_url(os.environ.get("TEST_DATABASE_URL", "sqlite://")))
    Base.metadata.drop_all(engine)
    init_db(engine)
    with make_session_factory(engine)() as s:
        yield s
    engine.dispose()


def make_fake(session, settings, quota=None):
    return FakeYouTube(QuotaTracker(session, quota or settings.daily_quota))


def count(session, model, *where):
    return session.scalar(select(func.count()).select_from(model).where(*where))


def test_parse_channel_query():
    assert parse_channel_query("@MrBeast") == ("handle", "@MrBeast")
    assert parse_channel_query("https://www.youtube.com/@MrBeast/videos") == ("handle", "@MrBeast")
    assert parse_channel_query("youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA") == (
        "id", "UCX6OQ3DkcsbYNE6H8uQQuVA")
    assert parse_channel_query("UCX6OQ3DkcsbYNE6H8uQQuVA") == ("id", "UCX6OQ3DkcsbYNE6H8uQQuVA")
    assert parse_channel_query("https://youtu.be/dQw4w9WgXcQ") == ("video", "dQw4w9WgXcQ")
    assert parse_channel_query("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1") == ("video", "dQw4w9WgXcQ")
    assert parse_channel_query("https://www.youtube.com/user/someone") == ("username", "someone")
    assert parse_channel_query("somecreator") == ("handle", "@somecreator")


def test_full_backfill_gets_every_comment_and_reply(session, settings):
    yt = make_fake(session, settings)
    # 120 videos (3 pages of uploads), 250 threads each on the first ones (3 pages), 7 replies each
    yt.add_channel(CID, "@chan", n_videos=120, comments_per_video=0)
    for vid in yt.uploads["UU" + CID[2:]][:3]:
        for j in range(250):
            yt.post_comment(vid, BASE + timedelta(minutes=j), replies=7 if j % 50 == 0 else 0)
    session.add(ChannelRequest(query="@chan"))
    session.commit()

    stats = run_sync(session, settings, yt=yt)

    assert stats.stopped_reason == "done"
    assert count(session, Channel) == 1
    assert count(session, Video) == 120
    expected = sum(int(v["statistics"]["commentCount"]) for v in yt.videos.values())
    assert count(session, Comment) == expected == 3 * (250 + 5 * 7)
    # replies beyond the 5 included ones were fetched separately
    assert count(session, Comment, Comment.parent_id.is_not(None)) == 3 * 5 * 7
    assert count(session, Video, Video.comments_backfilled.is_(False)) == 0
    # request is resolved
    assert session.scalars(select(ChannelRequest)).one().status == "done"


def test_second_run_is_cheap_and_picks_up_only_new_comments(session, settings):
    yt = make_fake(session, settings)
    yt.add_channel(CID, "@chan", n_videos=60, comments_per_video=30)
    Syncer(session, yt, settings).add_channel("@chan")
    run_sync(session, settings, yt=yt)
    total_before = count(session, Comment)
    assert total_before == 60 * 30

    # Nothing changed: the next run must not page through comments again.
    yt.calls.clear()
    for v in session.scalars(select(Video)):  # pretend stats are an hour old
        v.stats_updated_at -= timedelta(days=2)
    for c in session.scalars(select(Channel)):
        c.last_synced_at -= timedelta(hours=2)
    session.commit()
    run_sync(session, settings, yt=yt)
    assert "commentThreads" not in yt.calls
    assert count(session, Comment) == total_before

    # Two new comments on the newest video and one on an old one.
    newest, old = yt.uploads["UU" + CID[2:]][0], yt.uploads["UU" + CID[2:]][40]
    yt.post_comment(newest, BASE + timedelta(days=300), text="hello again")
    yt.post_comment(newest, BASE + timedelta(days=301), text="and again")
    yt.post_comment(old, BASE + timedelta(days=302), text="late comment")
    yt.calls.clear()
    for v in session.scalars(select(Video)):
        v.stats_updated_at -= timedelta(days=2)
    session.commit()
    run_sync(session, settings, yt=yt)
    assert count(session, Comment) == total_before + 3
    assert yt.calls.count("commentThreads") == 2  # one page per changed video
    texts = set(session.scalars(select(Comment.text).where(Comment.text.like("%again%"))))
    assert texts == {"hello again", "and again"}


def test_new_uploads_are_discovered(session, settings):
    yt = make_fake(session, settings)
    yt.add_channel(CID, "@chan", n_videos=5)
    Syncer(session, yt, settings).add_channel("@chan")
    run_sync(session, settings, yt=yt)
    assert count(session, Video) == 5

    playlist = "UU" + CID[2:]
    yt.videos["newvideo001"] = {
        "id": "newvideo001",
        "snippet": {"title": "Brand new", "publishedAt": "2026-06-01T00:00:00Z", "thumbnails": {}},
        "statistics": {"viewCount": "1", "likeCount": "0", "commentCount": "0"},
        "contentDetails": {"duration": "PT1M"},
    }
    yt.threads["newvideo001"] = []
    yt.uploads[playlist].insert(0, "newvideo001")
    run_sync(session, settings, yt=yt)
    assert session.get(Video, "newvideo001").title == "Brand new"


def test_quota_stops_run_and_next_run_resumes(session, settings):
    yt = make_fake(session, settings, quota=40)
    yt.add_channel(CID, "@chan", n_videos=2, comments_per_video=0)
    vid = yt.uploads["UU" + CID[2:]][0]
    for j in range(5000):  # 50 pages of comments
        yt.post_comment(vid, BASE + timedelta(minutes=j), append=False)
    session.add(ChannelRequest(query="@chan"))
    session.commit()

    stats = run_sync(session, settings, yt=yt)
    assert stats.stopped_reason.startswith("quota")
    partial = count(session, Comment)
    assert 0 < partial < 5000
    assert session.get(Video, vid).comments_page_token is not None

    # Next day: more quota, the backfill continues from the saved page.
    session.query(QuotaUsage).delete()
    session.commit()
    yt.quota.daily_limit = 1000
    stats = run_sync(session, settings, yt=yt)
    assert stats.stopped_reason == "done"
    assert count(session, Comment) == 5000


def test_comments_disabled_video_is_skipped(session, settings):
    yt = make_fake(session, settings)
    yt.add_channel(CID, "@chan", n_videos=3, comments_per_video=2)
    disabled = yt.uploads["UU" + CID[2:]][1]
    yt.disabled.add(disabled)
    Syncer(session, yt, settings).add_channel("@chan")
    run_sync(session, settings, yt=yt)
    assert session.get(Video, disabled).comments_disabled is True
    assert count(session, Comment) == 4


def test_unknown_channel_request_is_marked_error(session, settings):
    yt = make_fake(session, settings)
    session.add(ChannelRequest(query="@doesnotexist"))
    session.commit()
    run_sync(session, settings, yt=yt)
    req = session.scalars(select(ChannelRequest)).one()
    assert req.status == "error"


def test_multiple_channels(session, settings):
    yt = make_fake(session, settings)
    yt.add_channel(CID, "@chan", n_videos=3, comments_per_video=4)
    yt.add_channel(CID2, "@beta", n_videos=2, comments_per_video=5)
    session.add_all([ChannelRequest(query="@chan"), ChannelRequest(query="https://youtube.com/@beta")])
    session.commit()
    run_sync(session, settings, yt=yt)
    assert count(session, Comment, Comment.channel_id == CID) == 12
    assert count(session, Comment, Comment.channel_id == CID2) == 10


def test_lean_mode_skips_history_older_than_the_window(session, settings, monkeypatch):
    """Lean mode: videos older than HISTORY_DAYS aren't back-filled; their comment counts are taken as seen,
    so only comments that arrive later are fetched."""
    monkeypatch.setenv("HISTORY_DAYS", "1")
    fake = make_fake(session, settings)
    fake.add_channel(CID, "@chan", n_videos=10, comments_per_video=0)
    for vid in fake.uploads["UU" + CID[2:]][:3]:
        for j in range(30):
            fake.post_comment(vid, BASE + timedelta(minutes=j))
    session.add(ChannelRequest(query="@chan"))
    session.commit()
    run_sync(session, settings, yt=fake)
    assert count(session, Comment) == 0  # every fake video is older than a day
    vids = session.scalars(select(Video)).all()
    assert vids and all(v.comments_backfilled for v in vids)
    assert all(v.comment_count_checked == v.comment_count for v in vids)
