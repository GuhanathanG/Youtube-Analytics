"""E3: transcripts (what each new upload says), from YouTube's captions, free and without API quota.

Uses the open-source youtube-transcript-api (MIT). YouTube refuses many cloud machines ("IpBlocked"):
after BLOCK_LIMIT refusals in one run we stop, and wait TRANSCRIPT_BLOCK_HOURS (default 24) before trying
again, so we never hammer YouTube. Videos with no captions are remembered as "none" and not retried for a week.
Stored text is capped (TRANSCRIPT_MAX_CHARS) to keep the database small.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .db import Channel, Video, VideoTranscript, upsert, utcnow

log = logging.getLogger(__name__)
BLOCK_LIMIT = 2
LANGS = ["ta", "en", "hi", "te", "ml", "kn"]


def _blocked_recently(session: Session) -> bool:
    hours = float(os.environ.get("TRANSCRIPT_BLOCK_HOURS", "24"))
    last = session.scalar(select(VideoTranscript.fetched_at).where(VideoTranscript.status == "blocked")
                          .order_by(VideoTranscript.fetched_at.desc()).limit(1))
    ok_after = session.scalar(select(VideoTranscript.fetched_at).where(VideoTranscript.status == "ok")
                              .order_by(VideoTranscript.fetched_at.desc()).limit(1))
    return last is not None and last > utcnow() - timedelta(hours=hours) and (ok_after is None or ok_after < last)


def due_videos(session: Session, limit: int) -> list[Video]:
    now = utcnow()
    days = int(os.environ.get("TRANSCRIPT_DAYS", "30"))
    have = select(VideoTranscript.video_id).where(or_(
        VideoTranscript.status == "ok",
        (VideoTranscript.status == "none") & (VideoTranscript.fetched_at > now - timedelta(days=7))))
    return list(session.scalars(
        select(Video).join(Channel, Channel.id == Video.channel_id)
        .where(Channel.active.is_(True), Channel.platform.is_(None), Video.published_at >= now - timedelta(days=days),
               Video.published_at < now - timedelta(hours=2),  # captions appear a while after upload
               Video.id.not_in(have))
        .order_by(Video.published_at.desc()).limit(limit)).all())


def fetch_transcripts(session: Session, deadline: float | None = None, limit: int = 20, api=None) -> dict:
    """Fetch transcripts for recent uploads that don't have one. Returns counts."""
    out = {"ok": 0, "none": 0, "blocked": 0, "skipped": ""}
    if _blocked_recently(session):
        out["skipped"] = "YouTube blocked this machine recently; waiting before trying again"
        return out
    videos = due_videos(session, limit)
    if not videos:
        return out
    if api is None:
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
        except ImportError:
            out["skipped"] = "youtube-transcript-api not installed"
            return out
        api = YouTubeTranscriptApi()
    max_chars = int(os.environ.get("TRANSCRIPT_MAX_CHARS", "20000"))
    for v in videos:
        if deadline and time.time() > deadline:
            break
        row = {"video_id": v.id, "fetched_at": utcnow(), "lang": None, "generated": None, "text": None}
        try:
            listing = api.list(v.id)
            t = listing.find_transcript(LANGS)
            parts = t.fetch()
            text = " ".join(getattr(p, "text", p.get("text", "") if isinstance(p, dict) else "") for p in parts)
            row.update(status="ok", lang=t.language_code, generated=bool(t.is_generated), text=" ".join(text.split())[:max_chars])
            out["ok"] += 1
        except Exception as e:  # the library raises a different class per reason
            name = type(e).__name__
            if name in ("IpBlocked", "RequestBlocked", "TooManyRequests", "YouTubeRequestFailed"):
                row["status"] = "blocked"
                out["blocked"] += 1
            else:  # TranscriptsDisabled, NoTranscriptFound, VideoUnavailable, ...
                row["status"] = "none"
                out["none"] += 1
        upsert(session, VideoTranscript, [row], ["video_id"], ["status", "lang", "generated", "text", "fetched_at"])
        session.commit()
        if out["blocked"] >= BLOCK_LIMIT:
            log.warning("YouTube refuses transcript requests from this machine; trying again in a day")
            break
        time.sleep(float(os.environ.get("TRANSCRIPT_PAUSE_S", "1.5")))  # polite pace
    log.info("Transcripts: %s", out)
    return out
