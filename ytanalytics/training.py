"""Training database: channels watched only to teach the models, kept apart from the dashboard's database.

The main database (Supabase) holds your channels, competitors and comments. Training-only channels (other creators
in each niche) live in their own free database (Neon), so they can never fill or slow the dashboard:
  * `training_db` in the main database's app_secrets (or TRAINING_DATABASE_URL) says where it is;
  * it has the same tables, but only channels, videos and view snapshots are used (no comments);
  * `training-seed` adds the researched channel list (data/training/*.json), `training-sync` keeps it fresh, and the
    prediction engine (Creator Model) learns from both databases.
Each training channel keeps its newest TRAINING_MAX_VIDEOS uploads; older videos are refreshed weekly and view
snapshots are kept only while a video is young (see sync.py).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from .config import normalize_db_url
from .db import Channel, init_db, utcnow

log = logging.getLogger(__name__)

MIN_SUBSCRIBERS = int(os.environ.get("TRAINING_MIN_SUBS", "100000"))  # a name match below this is treated as doubtful


def training_url(main: Session) -> str | None:
    url = os.environ.get("TRAINING_DATABASE_URL", "").strip()
    if url:
        return url
    try:
        return main.execute(text("select value from app_secrets where name = 'training_db'")).scalar()
    except Exception:
        main.rollback()
        return None


def training_engine(main: Session):
    url = training_url(main)
    if not url:
        return None
    engine = create_engine(normalize_db_url(url), pool_pre_ping=True)
    init_db(engine)
    with engine.begin() as c:
        c.execute(text("""create table if not exists training_catalog (
            channel_id text, category text not null, query text primary key, title text, subscribers bigint,
            status text not null, note text, updated_at timestamp not null)"""))
    return engine


def _norm(s: str) -> set[str]:
    return {w for w in re.sub(r"[^a-z0-9 ]", " ", s.lower()).split() if len(w) > 1}


def name_matches(query: str, title: str, handle: str | None) -> bool:
    """A search result really is the named channel: most of the name's words appear in its title or handle."""
    want = _norm(query)
    have = _norm(title) | _norm((handle or "").replace("@", " ").replace("-", " ").replace("_", " "))
    squashed = re.sub(r"[^a-z0-9]", "", (title + (handle or "")).lower())
    hits = sum(1 for w in want if w in have or w in squashed)
    # Every word for short names (2-3 words), most of them for longer ones.
    return bool(want) and hits / len(want) >= (1.0 if len(want) <= 3 else 0.75)


def _looks_like_id_or_handle(q: str) -> bool:
    return q.startswith("@") or bool(re.fullmatch(r"UC[\w-]{22}", q)) or "youtube.com" in q


def resolve(yt, query: str) -> tuple[dict | None, str]:
    """(channel resource, how it was found). IDs/handles are exact; names go through search and must match."""
    if _looks_like_id_or_handle(query):
        item = yt.resolve_channel(query)
        return item, "exact" if item else "not found"
    if " " not in query:  # a one-word name is often also the handle (1 unit instead of 100)
        item = yt.resolve_channel("@" + query)
        if item and name_matches(query, item["snippet"]["title"], item["snippet"].get("customUrl")):
            return item, "handle"
    for item in yt.search_channel(query):
        if name_matches(query, item["snippet"]["title"], item["snippet"].get("customUrl")):
            return item, "search"
    return None, "no matching channel"


def seed(main: Session, yt, path: str | Path) -> dict:
    """Add the channels in a catalog file to the training database (skips ones already there)."""
    from .sync import Syncer  # noqa: PLC0415 (avoid an import cycle)
    from .config import Settings

    engine = training_engine(main)
    if engine is None:
        return {"error": "no training database (training_db in app_secrets)"}
    entries = json.loads(Path(path).read_text())["channels"] if path else []
    out = {"added": 0, "kept": 0, "doubtful": 0, "failed": 0}
    with Session(engine) as ts, engine.begin() as c:
        done = {r[0]: r[1] for r in c.execute(text("select query, status from training_catalog"))}
        # Channels added in the Model Lab wait as 'pending' rows.
        entries += [{"query": r[0], "category": r[1]} for r in c.execute(text(
            "select query, category from training_catalog where status = 'pending' order by updated_at"))]
        syncer = Syncer(ts, yt, Settings.from_env())
        for e in entries:
            q, cat = e["query"].strip(), e["category"]
            # Already handled: added ones are kept; doubtful and not-found names wait for a look in the Model Lab
            # (a name search costs 100 quota units, so they aren't retried every run). Lab requests come in as 'pending'.
            if q in done and done[q] != "pending":
                out["kept"] += 1
                continue
            try:
                item, how = resolve(yt, q)
            except Exception as ex:  # quota etc.: record and stop (the next run continues)
                c.execute(text("""insert into training_catalog (query, category, status, note, updated_at) values (:q, :c, 'failed', :n, now())
                    on conflict (query) do update set status = 'failed', note = excluded.note, updated_at = now()"""), {"q": q, "c": cat, "n": str(ex)[:300]})
                out["failed"] += 1
                break
            subs = int((item or {}).get("statistics", {}).get("subscriberCount") or 0)
            status = "added" if item and (how == "exact" or subs >= MIN_SUBSCRIBERS) else ("doubtful" if item else "failed")
            if item and status == "added":
                other = c.execute(text("select query from training_catalog where channel_id = :id and query <> :q and status = 'added'"),
                                  {"id": item["id"], "q": q}).scalar()
                if other:  # a name search landed on a channel that's already in the set under another entry
                    status, how = "doubtful", f"same channel as '{other}'"
            if status == "added":
                ch = ts.get(Channel, item["id"]) or Channel(id=item["id"])
                ch.active, ch.role = True, "training"
                if ch.videos_backfilled is None:
                    ch.videos_backfilled = False
                ts.add(ch)
                syncer._apply_channel(ch, item)
                ts.commit()
            c.execute(text("""insert into training_catalog (channel_id, query, category, title, subscribers, status, note, updated_at)
                values (:id, :q, :c, :t, :s, :st, :n, now()) on conflict (query) do update set channel_id = excluded.channel_id,
                category = excluded.category, title = excluded.title, subscribers = excluded.subscribers, status = excluded.status,
                note = excluded.note, updated_at = now()"""),
                {"id": item["id"] if item else None, "q": q, "c": cat, "t": item["snippet"]["title"] if item else None, "s": subs or None,
                 "st": status, "n": how if status != "doubtful" or how.startswith("same channel") else f"{how}: only {subs:,} subscribers, check it"})
            out[status if status in out else "failed"] += 1
    return out


def sync(main: Session, settings, minutes: float = 20) -> dict:
    """Channel stats, new uploads, a slice of history and video stats for every training channel."""
    from .sync import OutOfTime, QuotaExhausted, QuotaTracker, Syncer, YouTubeClient  # noqa: PLC0415

    engine = training_engine(main)
    if engine is None:
        return {"error": "no training database (training_db in app_secrets)"}
    # Quota is counted in the main database, with everything else, so the daily allowance is shared honestly.
    yt = YouTubeClient(settings.youtube_api_key, QuotaTracker(main, settings.daily_quota))
    from .progress import Progress

    prog = Progress(main, "channels")
    out = {"channels": 0}
    with Session(engine) as ts:
        syncer = Syncer(ts, yt, settings, time.monotonic() + minutes * 60)
        chans = list(ts.scalars(select(Channel).where(Channel.active.is_(True), Channel.role == "training")).all())
        out["channels"] = len(chans)
        try:
            syncer.refresh_channels(chans)
            for i, ch in enumerate(chans):
                prog.update(f"syncing {ch.title}", i, len(chans), note=f"{syncer.stats.videos_discovered:,} new videos so far", force=True)
                syncer.sync_uploads(ch)
                syncer.refresh_video_stats(ch)
        except (OutOfTime, QuotaExhausted) as e:
            ts.rollback()
            out["stopped"] = type(e).__name__
        out.update({"new_videos": syncer.stats.videos_discovered, "stats_refreshed": syncer.stats.videos_stats_refreshed})
        out["videos"] = ts.execute(text("select count(*) from videos")).scalar()
        out["at"] = utcnow().isoformat()
    prog.done(f"{out['channels']} channels, {out.get('videos', 0):,} videos in the training database (+{out.get('new_videos', 0):,})")
    return out
