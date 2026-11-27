"""Accuracy check for the month-long test: the dashboard's numbers against YouTube itself, right now.

For each of your YouTube channels (not rivals or training channels):
  - subscribers / total views / video count stored vs. live;
  - every upload in the channel's public RSS feed is in the database (none missed);
  - the 10 newest videos' views, likes and comment counts stored vs. live, with how old the stored numbers are;
  - comments collected vs. YouTube's own comment count for those videos.
Costs ~2 quota units per channel. Prints a JSON report (the daily review reads it)."""
from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from .db import Channel, Comment, Video, utcnow


def _gap(stored, live) -> float | None:
    if stored is None or live in (None, 0):
        return None
    return round((live - stored) / live, 4)


def check(session: Session, yt, fetch=None) -> dict:
    from .training import rss_video_ids

    now = utcnow()
    chans = list(session.scalars(select(Channel).where(Channel.active.is_(True), Channel.platform.is_(None),
                                                       or_(Channel.role.is_(None), Channel.role.not_in(["competitor", "training"])))).all())
    out = {"at": now.isoformat(), "channels": [], "problems": []}
    live_ch = {c["id"]: c for c in yt.get_channels(ids=[c.id for c in chans])} if chans else {}
    for ch in chans:
        lc = live_ch.get(ch.id, {}).get("statistics", {})
        row = {"id": ch.id, "title": ch.title,
               "subscribers": {"stored": ch.subscriber_count, "live": int(lc.get("subscriberCount", 0) or 0)},
               "videos_total": {"stored": ch.video_count, "live": int(lc.get("videoCount", 0) or 0)}}
        row["subscribers"]["gap"] = _gap(ch.subscriber_count, row["subscribers"]["live"])
        # Uploads missed: anything in the public feed (newest ~15) not stored, older than 1 h (time to be picked up).
        feed = rss_video_ids(ch.id, fetch)
        stored_ids = set(session.scalars(select(Video.id).where(Video.id.in_(feed))).all()) if feed else set()
        missing = [v for v in feed if v not in stored_ids]
        if missing:
            live_missing = {it["id"]: it for it in yt.get_videos(missing)}
            missing = [v for v, it in live_missing.items()
                       if it.get("snippet", {}).get("publishedAt", "9999") < (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")]
        row["feed_uploads"], row["missed_uploads"] = len(feed), missing
        vids = list(session.scalars(select(Video).where(Video.channel_id == ch.id).order_by(Video.published_at.desc()).limit(10)).all())
        live_v = {it["id"]: it for it in yt.get_videos([v.id for v in vids])} if vids else {}
        vrows = []
        for v in vids:
            st = live_v.get(v.id, {}).get("statistics", {})
            live_views, live_comments = int(st.get("viewCount", 0) or 0), int(st.get("commentCount", 0) or 0)
            collected = session.scalar(select(func.count()).select_from(Comment).where(Comment.video_id == v.id)) or 0
            try:  # comments moved to the archive still count (column added by the archive step)
                archived = session.execute(text("select archived_comments from videos where id = :i"), {"i": v.id}).scalar() or 0
            except Exception:  # noqa: BLE001
                session.rollback()
                archived = 0
            vrows.append({"id": v.id, "title": (v.title or "")[:60], "age_h": round((now - v.published_at).total_seconds() / 3600, 1) if v.published_at else None,
                          "views": {"stored": v.view_count, "live": live_views, "gap": _gap(v.view_count, live_views)},
                          "likes": {"stored": v.like_count, "live": int(st.get("likeCount", 0) or 0)},
                          "stats_age_h": round((now - v.stats_updated_at).total_seconds() / 3600, 1) if v.stats_updated_at else None,
                          "comments": {"collected": collected + archived, "youtube": live_comments,
                                       "share": round((collected + archived) / live_comments, 3) if live_comments else None}})
        row["videos"] = vrows
        out["channels"].append(row)
        # What the daily review flags
        if row["subscribers"]["gap"] is not None and abs(row["subscribers"]["gap"]) > 0.03:
            out["problems"].append(f"{ch.title}: subscribers off by {row['subscribers']['gap']:+.1%}")
        if missing:
            out["problems"].append(f"{ch.title}: {len(missing)} upload(s) in the feed but not in the dashboard")
        for r in vrows:
            if r["views"]["gap"] is not None and r["views"]["gap"] > 0.25 and (r["stats_age_h"] or 0) > 6:
                out["problems"].append(f"{ch.title}: '{r['title']}' views {r['views']['stored']} vs live {r['views']['live']} (stats {r['stats_age_h']} h old)")
            if r["comments"]["share"] is not None and r["comments"]["youtube"] >= 20 and r["comments"]["share"] < 0.8 and (r["age_h"] or 0) > 6:
                out["problems"].append(f"{ch.title}: '{r['title']}' has {r['comments']['collected']} of {r['comments']['youtube']} comments")
    return out


def main(session: Session, settings) -> str:
    from .youtube import QuotaTracker, YouTubeClient

    yt = YouTubeClient(settings.youtube_api_key, QuotaTracker(session, settings.daily_quota))
    return json.dumps(check(session, yt), default=str, indent=1, ensure_ascii=False)
