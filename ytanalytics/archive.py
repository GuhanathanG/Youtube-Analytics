"""Archive old, already-analysed comments to a second free database (e.g. Neon) so the main
Supabase database (500 MB free) never fills up.

What moves: comments older than ARCHIVE_AFTER_DAYS (default 90). The main database keeps only
recent comments plus every total (running totals, archive_stats), so it stays small and fast. Set
ARCHIVE_NEEDS_AI=1 to move only comments the local model and the AI have already read.
What stays: questions, requests and comments with 25+ likes (the valuable ones).

Several archive databases (each a free Neon project, ~0.5-1 GB): ARCHIVE_DATABASE_URLS (comma or
newline separated), ARCHIVE_DATABASE_URL, and rows named "archive_db_*" in the app_secrets table (so a
new one can be added without touching GitHub or Vercel settings). Comments go to the first one with
room (below ARCHIVE_SHARD_MB, default 450); the website searches all of them.
What is kept in the main database: per-channel, per-day counts of everything archived
(`archive_stats`), so totals and charts stay correct, and each video's archived count.
The AI's understanding is kept in Creator Memory (monthly memories + profile).

Runs whenever an archive database is set (ARCHIVE_AT_PERCENT, default 0, can make it wait until the
main database is that full of ARCHIVE_DB_LIMIT_MB, default 500).
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
  primary key (channel_id, day))
"""


def database_mb(session: Session) -> float:
    return float(session.execute(text("select pg_database_size(current_database())")).scalar() or 0) / 1048576


def archive_urls(session: Session | None = None, env=os.environ) -> list[str]:
    """Every configured archive database, in fill order (the database's list first, then the environment)."""
    urls: list[str] = []
    # Databases listed in the main database come first (the newest, closest ones are added there).
    if session is not None and session.get_bind().dialect.name == "postgresql":
        try:
            rows = session.execute(text("select value from app_secrets where name like 'archive_db_%' order by name")).scalars()
            urls += [u.strip() for u in rows if u and u.strip()]
        except Exception:
            session.rollback()  # no app_secrets table yet
    for raw in (env.get("ARCHIVE_DATABASE_URLS", ""), env.get("ARCHIVE_DATABASE_URL", "")):
        urls += [u.strip() for u in raw.replace("\n", ",").split(",") if u.strip()]
    seen: set[str] = set()
    return [u for u in urls if not (u in seen or seen.add(u))]


def should_archive(session: Session, env=os.environ) -> tuple[bool, str]:
    if not archive_urls(session, env):
        return False, "no archive database is set (ARCHIVE_DATABASE_URL or app_secrets archive_db_*)"
    if env.get("ARCHIVE_FORCE") == "1":
        return True, "forced"
    limit = float(env.get("ARCHIVE_DB_LIMIT_MB", "500"))
    # Default 0: keep the main database to recent comments all the time (old ones always move), so it
    # stays small and fast. A higher value waits until the database is that full.
    at = float(env.get("ARCHIVE_AT_PERCENT", "0"))
    mb = database_mb(session)
    if mb < limit * at / 100:
        return False, f"main database {mb:.0f} MB is under {at:.0f}% of {limit:.0f} MB"
    return True, f"main database {mb:.0f} MB is over {at:.0f}% of {limit:.0f} MB"


def _open_shard(url: str):
    engine = create_engine(normalize_db_url(url), pool_pre_ping=True)
    with engine.begin() as conn:
        for stmt in ARCHIVE_TABLE.strip().split(";"):
            if stmt.strip():
                conn.execute(text(stmt))
    return engine


def _shard_mb(engine) -> float:
    with engine.connect() as conn:
        if engine.dialect.name != "postgresql":
            return 0.0
        return float(conn.execute(text("select pg_database_size(current_database())")).scalar() or 0) / 1048576


def pick_shard(urls: list[str], limit_mb: float | None = None):
    """The first archive database with room left, or None when all are full."""
    limit_mb = limit_mb if limit_mb is not None else float(os.environ.get("ARCHIVE_SHARD_MB", "450"))
    for url in urls:
        try:
            engine = _open_shard(url)
        except Exception as e:  # unreachable: try the next one
            log.warning("Archive database not reachable: %s", str(e).splitlines()[0])
            continue
        if _shard_mb(engine) < limit_mb:
            return engine
        engine.dispose()
    return None


def archive_old_comments(session: Session, archive_url: str | list[str], *, batch: int = 5000, max_rows: int = 300_000,
                         after_days: int | None = None, deadline: float | None = None) -> int:
    """Move eligible comments in batches: copy to the archive, record their counts, then delete."""
    after_days = after_days if after_days is not None else int(os.environ.get("ARCHIVE_AFTER_DAYS", "90"))
    urls = [archive_url] if isinstance(archive_url, str) else list(archive_url)
    archive = pick_shard(urls)
    if archive is None:
        log.warning("Every archive database is full: add another (a free Neon project) as an archive_db_* row in app_secrets")
        return 0
    needs_ai = os.environ.get("ARCHIVE_NEEDS_AI", "0") == "1"
    read_filter = "and analyzed_at is not null and ai_at is not null" if needs_ai else ""
    dialect = session.get_bind().dialect.name
    session.execute(text(MAIN_TABLES))
    if dialect == "sqlite":  # tests
        cols = [r[1] for r in session.execute(text("pragma table_info(videos)"))]
        if "archived_comments" not in cols:
            session.execute(text("alter table videos add column archived_comments integer not null default 0"))
    else:  # look first: ALTER TABLE locks the table even when there's nothing to change
        if not session.execute(text("select 1 from information_schema.columns where table_schema = 'public' "
                                    "and table_name = 'videos' and column_name = 'archived_comments'")).first():
            session.execute(text("alter table videos add column if not exists archived_comments integer not null default 0"))
        if not session.execute(text("select relrowsecurity from pg_class where relname = 'archive_stats'")).scalar():
            session.execute(text("alter table archive_stats enable row level security"))
    session.commit()

    moved = 0
    cols = ", ".join(COLUMNS)
    while moved < max_rows and (deadline is None or time.monotonic() < deadline):
        rows = session.execute(text(f"""
            select {cols} from comments
            where published_at < :cutoff {read_filter}
              and coalesce(like_count, 0) < 25 and coalesce(is_question, false) = false and coalesce(is_suggestion, false) = false
            order by published_at asc nulls first limit :n"""), {"cutoff": _cutoff(after_days), "n": batch}).mappings().all()
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
        if moved % (batch * 10) == 0 and _shard_mb(archive) >= float(os.environ.get("ARCHIVE_SHARD_MB", "450")):
            archive.dispose()  # this one is full: carry on in the next
            archive = pick_shard(urls)
            if archive is None:
                log.warning("Every archive database is full: add another")
                return moved
    archive.dispose()
    if moved:
        compact_if_worth_it(session)
    return moved


def compact_if_worth_it(session: Session, env=os.environ) -> bool:
    """Postgres keeps the space of deleted rows for reuse but doesn't give it back, so the database still
    counts as full. Once most comments have moved out, rewrite the table (VACUUM FULL) to return the space.
    Only when few rows remain (fast, a few seconds of lock), and give up at once if the table is busy."""
    bind = session.get_bind()
    if bind.dialect.name != "postgresql":
        return False
    live, total = session.execute(text("""select coalesce(s.n_live_tup, 0), pg_total_relation_size('comments')
        from pg_stat_user_tables s where s.relname = 'comments'""")).one()
    max_rows = int(env.get("COMPACT_MAX_ROWS", "150000"))
    bytes_per_row = total / max(live, 1)
    if live > max_rows or bytes_per_row < float(env.get("COMPACT_BYTES_PER_ROW", "1500")):
        return False  # still lots of live rows (slow to rewrite), or not much space to win
    session.commit()
    log.info("Compacting the comments table (%d rows, %.0f MB) to give the freed space back", live, total / 1048576)
    try:
        with bind.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("set lock_timeout = '5s'"))
            conn.execute(text("set statement_timeout = 0"))
            conn.execute(text("vacuum full comments"))
            conn.execute(text("vacuum (analyze) comments"))
        log.info("Compacted: comments now %.0f MB", float(session.execute(text("select pg_total_relation_size('comments')")).scalar()) / 1048576)
        return True
    except Exception as e:
        log.warning("Compaction skipped this time: %s", str(e).splitlines()[0])
        return False


def _cutoff(days: int):
    from datetime import timedelta

    from .db import utcnow
    return utcnow() - timedelta(days=days)
