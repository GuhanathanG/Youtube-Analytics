"""Pull channels, videos and comments from YouTube into the database.

Each run does, in priority order, as much as the time limit and daily quota allow:

1. Resolve channels newly added from the dashboard.
2. Refresh channel stats and discover new uploads (full upload history on first run).
3. Refresh video stats (recent videos every run, older videos once a day).
4. NEW comments: for every video whose comment count went up, read from the newest
   comment down until we reach one we already have.
5. PAST comments: download the full comment history of each video, newest video first,
   resuming where the previous run stopped.

Everything is idempotent: re-running never creates duplicates.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import timedelta

from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.orm import Session

from .config import Settings
from .db import (
    Channel,
    ChannelRequest,
    ChannelSnapshot,
    Comment,
    RunLog,
    Video,
    VideoSnapshot,
    parse_ts,
    upsert,
    utcnow,
)
from .youtube import QuotaExhausted, QuotaTracker, YouTubeClient, YouTubeError

log = logging.getLogger(__name__)

COMMENT_UPDATE_COLS = [
    "text", "like_count", "reply_count", "updated_at", "fetched_at", "author_name",
]


@dataclass
class SyncStats:
    channels_added: int = 0
    channels_refreshed: int = 0
    videos_discovered: int = 0
    videos_stats_refreshed: int = 0
    new_comment_checks: int = 0
    backfill_pages: int = 0
    comments_saved: int = 0
    stopped_reason: str = "done"


class OutOfTime(Exception):
    pass


class Syncer:
    def __init__(self, session: Session, yt: YouTubeClient, settings: Settings,
                 deadline: float | None = None):
        self.s = session
        self.yt = yt
        self.settings = settings
        self.deadline = deadline
        self.stats = SyncStats()

    def _check_time(self) -> None:
        if self.deadline is not None and time.monotonic() > self.deadline:
            raise OutOfTime()

    # -- 1. channel requests -------------------------------------------------------
    def process_channel_requests(self) -> None:
        pending = self.s.scalars(
            select(ChannelRequest).where(ChannelRequest.status == "pending")
        ).all()
        for req in pending:
            self._check_time()
            try:
                item = self.yt.resolve_channel(req.query)
            except YouTubeError as e:
                req.status, req.error = "error", str(e)
                self.s.commit()
                continue
            if item is None:
                req.status, req.error = "error", "Channel not found. Try the @handle or channel URL."
                self.s.commit()
                continue
            channel = self.s.get(Channel, item["id"])
            if channel is None:
                channel = Channel(id=item["id"])
                self.s.add(channel)
                self.stats.channels_added += 1
            channel.active = True
            self._apply_channel(channel, item)
            req.status, req.channel_id, req.error = "done", item["id"], None
            self.s.commit()

    def add_channel(self, query: str) -> Channel | None:
        """Resolve and add a channel immediately (used by the command line)."""
        self.s.add(ChannelRequest(query=query))
        self.s.commit()
        self.process_channel_requests()
        req = self.s.scalars(
            select(ChannelRequest).where(ChannelRequest.query == query)
            .order_by(ChannelRequest.id.desc())
        ).first()
        return self.s.get(Channel, req.channel_id) if req and req.channel_id else None

    def _apply_channel(self, channel: Channel, item: dict) -> None:
        sn = item.get("snippet", {})
        st = item.get("statistics", {})
        channel.title = sn.get("title", channel.title or "")
        channel.handle = sn.get("customUrl") or channel.handle
        channel.description = sn.get("description")
        channel.country = sn.get("country")
        channel.thumbnail_url = _thumb(sn)
        channel.uploads_playlist_id = (
            item.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
            or channel.uploads_playlist_id
        )
        channel.subscriber_count = _int(st.get("subscriberCount"))
        channel.view_count = _int(st.get("viewCount"))
        channel.video_count = _int(st.get("videoCount"))
        channel.last_synced_at = utcnow()
        self.s.add(ChannelSnapshot(
            channel_id=channel.id,
            subscriber_count=channel.subscriber_count,
            view_count=channel.view_count,
            video_count=channel.video_count,
        ))

    # -- 2. channel stats + uploads ------------------------------------------------
    def refresh_channels(self, channels: list[Channel]) -> None:
        stale = [c for c in channels if c.last_synced_at is None
                 or utcnow() - c.last_synced_at > timedelta(minutes=55)]
        for i in range(0, len(stale), 50):
            self._check_time()
            chunk = stale[i:i + 50]
            items = {it["id"]: it for it in self.yt.get_channels(ids=[c.id for c in chunk])}
            for c in chunk:
                if c.id in items:
                    self._apply_channel(c, items[c.id])
                    self.stats.channels_refreshed += 1
            self.s.commit()

    def sync_uploads(self, channel: Channel) -> None:
        """New uploads first, then a limited slice of the upload history.

        Big channels have thousands of videos; walking the whole list before reading any
        comments meant no comments at all for days. Each run now takes at most
        `upload_pages_per_run` pages (50 videos each) of history, then moves on.
        """
        if not channel.uploads_playlist_id:
            return
        has_videos = self.s.scalar(select(Video.id).where(Video.channel_id == channel.id).limit(1)) is not None
        if has_videos:
            # Newest page(s) until we reach a video we already know.
            token = None
            for _ in range(5):
                self._check_time()
                data = self.yt.list_uploads(channel.uploads_playlist_id, token)
                ids = [it["contentDetails"]["videoId"] for it in data.get("items", [])]
                known = set(self.s.scalars(select(Video.id).where(Video.id.in_(ids))).all()) if ids else set()
                self._save_videos(channel, [v for v in ids if v not in known])
                token = data.get("nextPageToken")
                if known or not token:
                    break
        if channel.videos_backfilled:
            return
        # A slice of the upload history (resumable across runs).
        token = channel.videos_page_token
        for _ in range(max(1, self.settings.upload_pages_per_run)):
            self._check_time()
            try:
                data = self.yt.list_uploads(channel.uploads_playlist_id, token)
            except YouTubeError as e:
                if e.status == 404:  # channel has no uploads playlist yet
                    channel.videos_backfilled = True
                    self.s.commit()
                    return
                if e.status == 400 and token:  # expired page token: restart the walk
                    channel.videos_page_token = None
                    self.s.commit()
                    return
                raise
            ids = [it["contentDetails"]["videoId"] for it in data.get("items", [])]
            known = set(self.s.scalars(select(Video.id).where(Video.id.in_(ids))).all()) if ids else set()
            self._save_videos(channel, [v for v in ids if v not in known])
            token = data.get("nextPageToken")
            channel.videos_page_token = token
            if not token:
                channel.videos_backfilled = True
            self.s.commit()
            if not token:
                break

    def _save_videos(self, channel: Channel, ids: list[str]) -> None:
        """Insert new videos in bulk (a handful of queries, not one per video).

        The database may be on another continent (e.g. Supabase in Sydney, GitHub in the US),
        where every query costs ~0.2 s, so per-row ORM writes would eat the whole run.
        """
        if not ids:
            return
        items = self.yt.get_videos(ids)
        self._write_videos(channel.id, items)
        self.stats.videos_discovered += len(items)

    def _write_videos(self, channel_id: str, items: list[dict]) -> None:
        if not items:
            return
        now = utcnow()
        rows, snaps = [], []
        for item in items:
            sn = item.get("snippet", {})
            st = item.get("statistics", {})
            row = {
                "id": item["id"], "channel_id": channel_id, "title": sn.get("title", ""),
                "description": sn.get("description"), "published_at": parse_ts(sn.get("publishedAt")),
                "thumbnail_url": _thumb(sn), "duration": item.get("contentDetails", {}).get("duration"),
                "view_count": _int(st.get("viewCount")), "like_count": _int(st.get("likeCount")),
                "comment_count": _int(st.get("commentCount")), "stats_updated_at": now,
                "comments_disabled": "commentCount" not in st, "comments_backfilled": False,
            }
            rows.append(row)
            snaps.append({"video_id": row["id"], "taken_at": now, "view_count": row["view_count"],
                          "like_count": row["like_count"], "comment_count": row["comment_count"]})
        upsert(self.s, Video, rows, ["id"], [
            "title", "description", "published_at", "thumbnail_url", "duration", "view_count", "like_count",
            "comment_count", "stats_updated_at", "comments_disabled",
        ])
        self.s.execute(insert(VideoSnapshot), snaps)
        self.s.commit()
        self.s.expire_all()  # ORM objects loaded earlier must see the new numbers

    # -- 3. video stats ------------------------------------------------------------
    def refresh_video_stats(self, channel: Channel) -> None:
        now = utcnow()
        recent_cutoff = now - timedelta(days=self.settings.live_window_days)
        rows = self.s.execute(
            select(Video.id, Video.published_at, Video.stats_updated_at).where(Video.channel_id == channel.id)
        ).all()
        due = []
        for vid, published, updated in rows:
            if updated is None:
                due.append(vid)
                continue
            age = now - updated
            is_recent = published is not None and published >= recent_cutoff
            if (is_recent and age > timedelta(minutes=25)) or age > timedelta(hours=23):
                due.append(vid)
        for i in range(0, len(due), 50):
            self._check_time()
            chunk = due[i:i + 50]
            items = self.yt.get_videos(chunk)
            self._write_videos(channel.id, items)
            self.stats.videos_stats_refreshed += len(items)
            gone = set(chunk) - {it["id"] for it in items}
            if gone:  # deleted or made private: don't ask again until tomorrow
                self.s.execute(update(Video).where(Video.id.in_(gone)).values(stats_updated_at=now))
                self.s.commit()

    # -- comments ------------------------------------------------------------------
    def _active_channel_ids(self) -> list[str]:
        """Channels whose comments are collected (YouTube, not competitors)."""
        return list(self.s.scalars(select(Channel.id).where(
            Channel.active.is_(True), Channel.platform.is_(None),
            or_(Channel.role.is_(None), Channel.role != "competitor"))).all())

    def sync_new_comments(self) -> None:
        """Pick up comments posted since the last run."""
        channel_ids = self._active_channel_ids()
        if not channel_ids:
            return
        videos = self.s.scalars(
            select(Video).where(
                Video.channel_id.in_(channel_ids),
                Video.comments_disabled.is_(False),
                Video.latest_comment_at.is_not(None),
                or_(Video.comment_count_checked.is_(None),
                    Video.comment_count > Video.comment_count_checked),
            ).order_by(Video.published_at.desc())
        ).all()
        for video in videos:
            self._check_time()
            self._fetch_new_comments(video)
            self.stats.new_comment_checks += 1

    def _fetch_new_comments(self, video: Video) -> None:
        stop_at = video.latest_comment_at
        token = None
        while True:
            self._check_time()
            try:
                data = self.yt.list_comment_threads(video.id, token)
            except YouTubeError as e:
                if self._handle_comment_error(video, e):
                    return
                raise
            items = data.get("items", [])
            reached_known = False
            fresh = []
            for it in items:
                published = parse_ts(it["snippet"]["topLevelComment"]["snippet"].get("publishedAt"))
                fresh.append(it)
                if stop_at is not None and published is not None and published <= stop_at:
                    reached_known = True
            self._save_threads(video, fresh)
            token = data.get("nextPageToken")
            if reached_known or not token:
                break
        video.comment_count_checked = video.comment_count
        video.comments_checked_at = utcnow()
        self.s.commit()

    def backfill_comments(self) -> None:
        """Download the full comment history, newest videos first."""
        channel_ids = self._active_channel_ids()
        if not channel_ids:
            return
        # Videos with no comments yet are "done" right away: one statement for all of them.
        now = utcnow()
        self.s.execute(
            update(Video)
            .where(Video.channel_id.in_(channel_ids), Video.comments_backfilled.is_(False),
                   Video.comments_disabled.is_(False), Video.comment_count == 0)
            .values(comments_backfilled=True, comment_count_checked=0,
                    latest_comment_at=func.coalesce(Video.latest_comment_at, Video.published_at, now))
        )
        self.s.commit()
        self.s.expire_all()
        while True:
            self._check_time()
            video = self.s.scalars(
                select(Video).where(
                    Video.channel_id.in_(channel_ids),
                    Video.comments_backfilled.is_(False),
                    Video.comments_disabled.is_(False),
                ).order_by(Video.published_at.desc()).limit(1)
            ).first()
            if video is None:
                return
            self._backfill_video(video)

    def _backfill_video(self, video: Video) -> None:
        if video.comment_count == 0:
            video.comments_backfilled = True
            video.comment_count_checked = 0
            # Nothing to read yet; new comments will be picked up incrementally.
            video.latest_comment_at = video.latest_comment_at or video.published_at or utcnow()
            self.s.commit()
            return
        count_at_start = video.comment_count
        token = video.comments_page_token
        while True:
            self._check_time()
            try:
                data = self.yt.list_comment_threads(video.id, token)
            except YouTubeError as e:
                if self._handle_comment_error(video, e):
                    return
                if e.status == 400 and token:  # expired page token: restart this video
                    log.warning("Page token expired for %s, restarting backfill", video.id)
                    video.comments_page_token = None
                    self.s.commit()
                    token = None
                    continue
                raise
            self._save_threads(video, data.get("items", []))
            self.stats.backfill_pages += 1
            token = data.get("nextPageToken")
            video.comments_page_token = token
            if not token:
                video.comments_backfilled = True
                video.comment_count_checked = count_at_start
                video.comments_checked_at = utcnow()
                if video.latest_comment_at is None:
                    video.latest_comment_at = video.published_at or utcnow()
            self.s.commit()
            if not token:
                return

    def _handle_comment_error(self, video: Video, e: YouTubeError) -> bool:
        """Returns True if the error means 'this video has no readable comments'."""
        if e.reason in ("commentsDisabled", "videoNotFound", "forbidden") or e.status == 404:
            video.comments_disabled = True
            video.comments_backfilled = True
            self.s.commit()
            return True
        return False

    def _save_threads(self, video: Video, items: list[dict]) -> None:
        rows: list[dict] = []
        now = utcnow()
        newest = video.latest_comment_at
        for it in items:
            top = it["snippet"]["topLevelComment"]
            total_replies = it["snippet"].get("totalReplyCount", 0)
            row = _comment_row(top, video, parent_id=None, now=now)
            row["reply_count"] = total_replies
            rows.append(row)
            if row["published_at"] and (newest is None or row["published_at"] > newest):
                newest = row["published_at"]
            included = it.get("replies", {}).get("comments", [])
            if self.settings.fetch_all_replies and total_replies > len(included):
                rows.extend(self._fetch_all_replies(top["id"], video, now))
            else:
                rows.extend(_comment_row(r, video, parent_id=top["id"], now=now) for r in included)
        for i in range(0, len(rows), 500):
            upsert(self.s, Comment, rows[i:i + 500], ["id"], COMMENT_UPDATE_COLS)
        video.latest_comment_at = newest
        self.stats.comments_saved += len(rows)
        self.s.commit()

    def _fetch_all_replies(self, parent_id: str, video: Video, now) -> list[dict]:
        rows, token = [], None
        while True:
            data = self.yt.list_replies(parent_id, token)
            rows.extend(_comment_row(r, video, parent_id=parent_id, now=now)
                        for r in data.get("items", []))
            token = data.get("nextPageToken")
            if not token:
                return rows


def _comment_row(c: dict, video: Video, parent_id: str | None, now) -> dict:
    sn = c.get("snippet", {})
    return {
        "id": c["id"],
        "video_id": video.id,
        "channel_id": video.channel_id,
        "parent_id": parent_id or sn.get("parentId"),
        "author_name": sn.get("authorDisplayName"),
        "author_channel_id": (sn.get("authorChannelId") or {}).get("value"),
        "text": sn.get("textOriginal") or sn.get("textDisplay") or "",
        "like_count": _int(sn.get("likeCount")) or 0,
        "reply_count": 0,
        "published_at": parse_ts(sn.get("publishedAt")),
        "updated_at": parse_ts(sn.get("updatedAt")),
        "fetched_at": now,
    }


def _int(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _thumb(snippet: dict) -> str | None:
    thumbs = snippet.get("thumbnails") or {}
    for key in ("high", "medium", "default"):
        if key in thumbs:
            return thumbs[key].get("url")
    return None


def run_sync(session: Session, settings: Settings, yt: YouTubeClient | None = None) -> SyncStats:
    """One full sync pass. Safe to run as often as you like."""
    yt = yt or YouTubeClient(settings.youtube_api_key, QuotaTracker(session, settings.daily_quota))
    deadline = time.monotonic() + settings.max_run_minutes * 60
    syncer = Syncer(session, yt, settings, deadline)
    run = RunLog(kind="sync")
    session.add(run)
    session.commit()
    try:
        syncer.process_channel_requests()
        channels = list(session.scalars(select(Channel).where(Channel.active.is_(True), Channel.platform.is_(None))).all())
        syncer.refresh_channels(channels)
        for channel in channels:
            syncer.sync_uploads(channel)
            syncer.refresh_video_stats(channel)
        syncer.sync_new_comments()
        syncer.backfill_comments()
        run.status = "ok"
    except QuotaExhausted as e:
        session.rollback()
        syncer.stats.stopped_reason = f"quota: {e}"
        run.status = "ok"
    except OutOfTime:
        session.rollback()
        syncer.stats.stopped_reason = "time limit"
        run.status = "ok"
    except Exception as e:  # keep a record, then fail the job so GitHub shows it red
        session.rollback()
        run.status = "error"
        syncer.stats.stopped_reason = f"error: {e!r}"[:1000]
        run.summary = json.dumps(asdict(syncer.stats))
        run.finished_at = utcnow()
        session.commit()
        raise
    run.summary = json.dumps(asdict(syncer.stats))
    run.finished_at = utcnow()
    session.commit()
    return syncer.stats
