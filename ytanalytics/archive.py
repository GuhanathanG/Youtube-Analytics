"""Archive old, already-analysed comments to a second free database (e.g. Neon) so the main
Supabase database (500 MB free) never fills up.

What moves: comments older than ARCHIVE_AFTER_DAYS (default 180) that the local model AND the AI
have already read. What stays: questions, requests and comments with 25+ likes (the valuable ones).
What is kept in the main database: per-channel, per-day counts of everything archived
(`archive_stats`), so totals and charts stay correct, and each video's archived count.
The AI's understanding is kept in Creator Memory (monthly memories + profile).

Runs only when ARCHIVE_DATABASE_URL is set and the main database is above ARCHIVE_AT_PERCENT
(default 70) of ARCHIVE_DB_LIMIT_MB (default 500), or when ARCHIVE_FORCE=1.
"""
from __future__ import annotations

import logging
import os
import time
from collections import defaultdict

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from .config import normalize_db_url

log = logging.getLogger(__name__)

COLUMNS = ["id", "video_id", "channel_id", "parent_id", "author_name", "author_channel_id", "text", "like_count",
           "reply_count", "published_at", "updated_at", "fetched_at", "language", "sentiment", "sentiment_score",
           "sentiment_value", "analyzed_at", "analyzer", "sentiment_source", "emotion", "is_question", "is_suggestion",
           "is_spam", "is_toxic", "aspects", "translation", "ai_at", "ai_model"]

ARCHIVE_TABLE = """
create table if not exists comments (
  id text primary key, video_id text not null, channel_id text not null, parent_id text, author_name text,
  author_channel_id text, text text not null default '', like_count integer, reply_count integer,
  published_at timestamp, updated_at timestamp, fetched_at timestamp, language text, sentiment text,
  sentiment_score double precision, sentiment_value double precision, analyzed_at timestamp, analyzer text,
  sentiment_source text, emotion text, is_question boolean, is_suggestion boolean, is_spam boolean, is_toxic boolean,
  aspects text, translation text, ai_at timestamp, ai_model text, archived_at timestamp default CURRENT_TIMESTAMP);
create index if not exists ix_archive_channel_published on comments (channel_id, published_at);
create index if not exists ix_archive_author on comments (author_channel_id);
create index if not exists ix_archive_video on comments (video_id);
"""

MAIN_TABLES = """
create table if not exists archive_stats (
  channel_id text not null, day date not null, comments integer not null default 0, positive integer not null default 0,
  neutral integer not null default 0, negative integer not null default 0, sentiment_sum double precision not null default 0,
  sentiment_n integer not null default 0, analyzed integer not null default 0, ai_read integer not null default 0,
  primary key (channel_id, day));
alter table archive_stats enable row level security;
alter table videos add column if not exists archived_comments integer not null default 0;
"""


def database_mb(session: Session) -> float:
    return float(session.execute(text("select pg_database_size(current_database())")).scalar() or 0) / 1048576


def should_archive(session: Session, env=os.environ) -> tuple[bool, str]:
    if not env.get("ARCHIVE_DATABASE_URL"):
        return False, "ARCHIVE_DATABASE_URL is not set"
    if env.get("ARCHIVE_FORCE") == "1":
        return True, "forced"
    limit = float(env.get("ARCHIVE_DB_LIMIT_MB", "500"))
    at = float(env.get("ARCHIVE_AT_PERCENT", "70"))
    mb = database_mb(session)
    if mb < limit * at / 100:
        return False, f"main database {mb:.0f} MB is under {at:.0f}% of {limit:.0f} MB"
    return True, f"main database {mb:.0f} MB is over {at:.0f}% of {limit:.0f} MB"


def archive_old_comments(session: Session, archive_url: str, *, batch: int = 5000, max_rows: int = 100_000,
                         after_days: int | None = None, deadline: float | None = None) -> int:
    """Move eligible comments in batches: copy to the archive, record their counts, then delete."""
    after_days = after_days if after_days is not None else int(os.environ.get("ARCHIVE_AFTER_DAYS", "180"))
    archive = create_engine(normalize_db_url(archive_url), pool_pre_ping=True)
    with archive.begin() as conn:
        for stmt in ARCHIVE_TABLE.strip().split(";"):
            if stmt.strip():
                conn.execute(text(stmt))
    dialect = session.get_bind().dialect.name
    for stmt in MAIN_TABLES.strip().split(";"):
        if stmt.strip() and not (dialect == "sqlite" and ("row level" in stmt or "if not exists archived" in stmt)):
            session.execute(text(stmt))
    if dialect == "sqlite":  # tests: add the column the simple way
        cols = [r[1] for r in session.execute(text("pragma table_info(videos)"))]
        if "archived_comments" not in cols:
            session.execute(text("alter table videos add column archived_comments integer not null default 0"))
    session.commit()

    moved = 0
    cols = ", ".join(COLUMNS)
    while moved < max_rows and (deadline is None or time.monotonic() < deadline):
        rows = session.execute(text(f"""
            select {cols} from comments
            where published_at < :cutoff and analyzed_at is not null and ai_at is not null
              and coalesce(like_count, 0) < 25 and coalesce(is_question, false) = false and coalesce(is_suggestion, false) = false
            order by published_at limit :n"""), {"cutoff": _cutoff(after_days), "n": batch}).mappings().all()
        if not rows:
            break
        data = [dict(r) for r in rows]
        with archive.begin() as conn:  # 1. copy (idempotent)
            conn.execute(text(f"insert into comments ({cols}) values ({', '.join(':' + c for c in COLUMNS)}) "
                              "on conflict (id) do nothing"), data)
        stats: dict = defaultdict(lambda: [0, 0, 0, 0, 0.0, 0, 0, 0])
        per_video: dict = defaultdict(int)
        for r in data:  # 2. remember their counts
            day = (r["published_at"].date() if hasattr(r["published_at"], "date") else str(r["published_at"])[:10])
            s = stats[(r["channel_id"], day)]
            s[0] += 1
            s[1] += r["sentiment"] == "positive"
            s[2] += r["sentiment"] == "neutral"
            s[3] += r["sentiment"] == "negative"
            if r["sentiment_value"] is not None:
                s[4] += float(r["sentiment_value"]); s[5] += 1
            s[6] += r["analyzed_at"] is not None
            s[7] += r["ai_at"] is not None
            per_video[r["video_id"]] += 1
        for (ch, day), s in stats.items():
            session.execute(text("""
                insert into archive_stats (channel_id, day, comments, positive, neutral, negative, sentiment_sum, sentiment_n, analyzed, ai_read)
                values (:ch, :day, :c, :p, :u, :n, :ss, :sn, :a, :ai)
                on conflict (channel_id, day) do update set comments = archive_stats.comments + excluded.comments,
                  positive = archive_stats.positive + excluded.positive, neutral = archive_stats.neutral + excluded.neutral,
                  negative = archive_stats.negative + excluded.negative, sentiment_sum = archive_stats.sentiment_sum + excluded.sentiment_sum,
                  sentiment_n = archive_stats.sentiment_n + excluded.sentiment_n, analyzed = archive_stats.analyzed + excluded.analyzed,
                  ai_read = archive_stats.ai_read + excluded.ai_read"""),
                {"ch": ch, "day": day, "c": s[0], "p": s[1], "u": s[2], "n": s[3], "ss": s[4], "sn": s[5], "a": s[6], "ai": s[7]})
        for vid, n in per_video.items():
            session.execute(text("update videos set archived_comments = coalesce(archived_comments, 0) + :n where id = :v"), {"n": n, "v": vid})
        ids = [r["id"] for r in data]  # 3. delete from the main database (same transaction as the counts)
        for i in range(0, len(ids), 1000):
            session.execute(text("delete from comments where id in (" + ", ".join(f":i{j}" for j in range(len(ids[i:i + 1000]))) + ")"),
                            {f"i{j}": v for j, v in enumerate(ids[i:i + 1000])})
        session.commit()
        moved += len(data)
        log.info("Archived %d comments so far", moved)
    archive.dispose()
    return moved


def _cutoff(days: int):
    from datetime import timedelta

    from .db import utcnow
    return utcnow() - timedelta(days=days)
