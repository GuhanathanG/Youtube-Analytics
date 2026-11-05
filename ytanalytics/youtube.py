"""Thin YouTube Data API v3 client with quota accounting.

Only public data is used, so a plain API key is enough (no Google sign-in).
Every list call used here costs 1 quota unit.
"""
from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import requests
from sqlalchemy.orm import Session

from .db import QuotaUsage

API_BASE = "https://www.googleapis.com/youtube/v3"
PACIFIC = ZoneInfo("America/Los_Angeles")


class QuotaExhausted(Exception):
    """Today's YouTube quota budget is used up; try again after midnight Pacific time."""


class YouTubeError(Exception):
    def __init__(self, status: int, reason: str, message: str):
        super().__init__(f"{status} {reason}: {message}")
        self.status = status
        self.reason = reason


def quota_day(now: datetime | None = None) -> str:
    """The quota day YouTube uses: the calendar date in Pacific time."""
    now = now or datetime.now(tz=PACIFIC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=ZoneInfo("UTC"))
    return now.astimezone(PACIFIC).strftime("%Y-%m-%d")


class QuotaTracker:
    """Counts units in the `quota_usage` table.

    It shares the sync run's session and commits on every spend, so work saved before an
    API call is never lost if the run stops later.
    """

    def __init__(self, session: Session, daily_limit: int):
        self.session = session
        self.daily_limit = daily_limit

    def used_today(self) -> int:
        from sqlalchemy import select

        units = self.session.execute(select(QuotaUsage.units).where(QuotaUsage.day == quota_day())).scalar()
        return units or 0

    def remaining(self) -> int:
        return max(0, self.daily_limit - self.used_today())

    def spend(self, units: int) -> None:
        """Reserve units with one atomic statement (one round trip to a far-away database)."""
        from sqlalchemy import update

        dialect = self.session.get_bind().dialect.name
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        else:
            from sqlalchemy.dialects.sqlite import insert
        day = quota_day()
        stmt = insert(QuotaUsage).values(day=day, units=units)
        stmt = stmt.on_conflict_do_update(index_elements=["day"], set_={"units": QuotaUsage.units + units})
        used = self.session.execute(stmt.returning(QuotaUsage.units)).scalar_one()
        if used > self.daily_limit:
            self.session.execute(update(QuotaUsage).where(QuotaUsage.day == day).values(units=QuotaUsage.units - units))
            self.session.commit()
            raise QuotaExhausted(f"Daily budget of {self.daily_limit} units reached ({used - units} used)")
        self.session.commit()


class YouTubeClient:
    def __init__(self, api_key: str, quota: QuotaTracker, http: requests.Session | None = None):
        if not api_key:
            raise ValueError("YOUTUBE_API_KEY is not set")
        self.api_key = api_key
        self.quota = quota
        self.http = http or requests.Session()

    # -- low level -----------------------------------------------------------------
    def _get(self, endpoint: str, params: dict[str, Any], cost: int = 1) -> dict:
        self.quota.spend(cost)
        params = {k: v for k, v in params.items() if v is not None}
        params["key"] = self.api_key
        for attempt in range(4):
            resp = self.http.get(f"{API_BASE}/{endpoint}", params=params, timeout=30)
            if resp.status_code in (500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            break
        if resp.status_code != 200:
            reason, message = "unknown", resp.text[:300]
            try:
                err = resp.json()["error"]
                message = err.get("message", message)
                if err.get("errors"):
                    reason = err["errors"][0].get("reason", reason)
            except (ValueError, KeyError, TypeError):
                pass
            if reason in ("quotaExceeded", "dailyLimitExceeded"):
                raise QuotaExhausted(message)
            raise YouTubeError(resp.status_code, reason, message)
        return resp.json()

    # -- channels ------------------------------------------------------------------
    def get_channels(self, *, ids: list[str] | None = None, handle: str | None = None,
                     username: str | None = None) -> list[dict]:
        params: dict[str, Any] = {"part": "snippet,statistics,contentDetails", "maxResults": 50}
        if ids:
            params["id"] = ",".join(ids)
        elif handle:
            params["forHandle"] = handle if handle.startswith("@") else "@" + handle
        elif username:
            params["forUsername"] = username
        else:
            raise ValueError("ids, handle or username required")
        return self._get("channels", params).get("items", [])

    def resolve_channel(self, query: str) -> dict | None:
        """Turn a URL, @handle, channel ID or video URL into a channel resource."""
        kind, value = parse_channel_query(query)
        if kind == "id":
            items = self.get_channels(ids=[value])
        elif kind == "handle":
            items = self.get_channels(handle=value)
        elif kind == "username":
            items = self.get_channels(username=value) or self.get_channels(handle=value)
        elif kind == "video":
            videos = self.get_videos([value])
            if not videos:
                return None
            items = self.get_channels(ids=[videos[0]["snippet"]["channelId"]])
        else:
            return None
        return items[0] if items else None

    # -- videos --------------------------------------------------------------------
    def list_uploads(self, playlist_id: str, page_token: str | None = None) -> dict:
        return self._get("playlistItems", {
            "part": "contentDetails",
            "playlistId": playlist_id,
            "maxResults": 50,
            "pageToken": page_token,
        })

    def get_videos(self, ids: list[str]) -> list[dict]:
        items: list[dict] = []
        for i in range(0, len(ids), 50):
            chunk = ids[i:i + 50]
            data = self._get("videos", {
                "part": "snippet,statistics,contentDetails",
                "id": ",".join(chunk),
                "maxResults": 50,
            })
            items.extend(data.get("items", []))
        return items

    # -- comments ------------------------------------------------------------------
    def list_comment_threads(self, video_id: str, page_token: str | None = None) -> dict:
        return self._get("commentThreads", {
            "part": "snippet,replies",
            "videoId": video_id,
            "order": "time",
            "maxResults": 100,
            "textFormat": "plainText",
            "pageToken": page_token,
        })

    def list_replies(self, parent_id: str, page_token: str | None = None) -> dict:
        return self._get("comments", {
            "part": "snippet",
            "parentId": parent_id,
            "maxResults": 100,
            "textFormat": "plainText",
            "pageToken": page_token,
        })


_CHANNEL_ID_RE = re.compile(r"^UC[\w-]{22}$")


def parse_channel_query(query: str) -> tuple[str, str]:
    """Classify user input. Returns (kind, value) with kind in id|handle|username|video|unknown."""
    q = query.strip()
    if not q:
        return "unknown", ""
    if _CHANNEL_ID_RE.match(q):
        return "id", q
    if q.startswith("@"):
        return "handle", q
    if "://" not in q and ("youtube.com" in q or "youtu.be" in q):
        q = "https://" + q
    if "://" in q:
        url = urlparse(q)
        host = url.netloc.lower()
        parts = [p for p in url.path.split("/") if p]
        if host.endswith("youtu.be") and parts:
            return "video", parts[0]
        if "youtube.com" in host:
            if parts and parts[0].startswith("@"):
                return "handle", parts[0]
            if len(parts) >= 2 and parts[0] == "channel":
                return "id", parts[1]
            if len(parts) >= 2 and parts[0] in ("user", "c"):
                return "username", parts[1]
            if parts and parts[0] == "watch":
                v = parse_qs(url.query).get("v")
                if v:
                    return "video", v[0]
            if len(parts) >= 2 and parts[0] in ("shorts", "live", "embed"):
                return "video", parts[1]
        return "unknown", q
    # A bare word: treat as a handle.
    if re.match(r"^[\w.\-]+$", q):
        return "handle", "@" + q
    return "unknown", q
