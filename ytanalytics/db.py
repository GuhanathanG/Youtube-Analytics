"""Database tables. Works with SQLite (local testing) and PostgreSQL (Supabase in production).

All timestamps are stored as naive UTC datetimes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Sequence

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text as sql_text,
    create_engine,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def parse_ts(value: str | None) -> datetime | None:
    """Parse YouTube's ISO-8601 timestamps ('2024-05-01T12:34:56Z') into naive UTC."""
    if not value:
        return None
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


class Base(DeclarativeBase):
    pass


class ChannelRequest(Base):
    """A channel the user asked to track from the dashboard; the worker resolves it."""

    __tablename__ = "channel_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    query: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|done|error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    handle: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    country: Mapped[str | None] = mapped_column(String(10), nullable=True)
    uploads_playlist_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    subscriber_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    view_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    video_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # None = YouTube; "instagram" = an Instagram account (collected by the website engine via Apify).
    platform: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # None = one of your channels; "competitor" = watched for videos and stats only (no comments: saves quota and AI).
    role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Paging through the full upload history happens once, possibly across several runs.
    videos_backfilled: Mapped[bool] = mapped_column(Boolean, default=False)
    videos_page_token: Mapped[str | None] = mapped_column(String(200), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ChannelSnapshot(Base):
    """Channel stats over time, so the dashboard can chart growth."""

    __tablename__ = "channel_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel_id: Mapped[str] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), index=True)
    taken_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    subscriber_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    view_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    video_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    channel_id: Mapped[str] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    duration: Mapped[str | None] = mapped_column(String(32), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    view_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    like_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    comment_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    stats_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    comments_disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Full history download of comments (newest -> oldest), resumable across runs.
    comments_backfilled: Mapped[bool] = mapped_column(Boolean, default=False)
    comments_page_token: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Newest top-level comment we have seen; incremental sync stops when it reaches it.
    latest_comment_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # commentCount reported by YouTube the last time we checked for new comments.
    comment_count_checked: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    comments_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class VideoSnapshot(Base):
    __tablename__ = "video_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    taken_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    view_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    like_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    comment_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    # video_id is covered by ix_comments_video_published; parent_id/language/sentiment/emotion
    # indexes were dropped: each cost ~40 bytes per comment and filters on them are rare.
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"))
    channel_id: Mapped[str] = mapped_column(String(64), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    author_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    author_channel_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    text: Mapped[str] = mapped_column(Text, default="")
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    reply_count: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Filled in by the analyze step.
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sentiment: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sentiment_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # confidence 0..1
    sentiment_value: Mapped[float | None] = mapped_column(Float, nullable=True)  # -1 (neg) .. +1 (pos)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    analyzer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Filled in by the AI (LLM) pass. When present, `sentiment` above holds the AI's label
    # and `sentiment_source` is "ai"; otherwise it is "model" (the local classifier).
    sentiment_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    emotion: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_question: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_suggestion: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_spam: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_toxic: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    aspects: Mapped[str | None] = mapped_column(String(300), nullable=True)  # "audio:neg,editing:pos"
    translation: Mapped[str | None] = mapped_column(Text, nullable=True)  # English, if not English
    ai_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    ai_model: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        Index("ix_comments_video_published", "video_id", "published_at"),
        Index("ix_comments_pending", "analyzed_at"),
        # Replies only (small): lets "did the creator answer this question?" be checked quickly.
        Index("ix_comments_parent", "parent_id", "author_channel_id",
              postgresql_where=sql_text("parent_id IS NOT NULL"), sqlite_where=sql_text("parent_id IS NOT NULL")),
    )


class Insight(Base):
    """AI-written analysis of a video or a channel (JSON in `data`)."""

    __tablename__ = "insights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(10))  # video | channel
    target_id: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)  # comments stored at the time
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    data: Mapped[str] = mapped_column(Text, default="{}")


class Topic(Base):
    """Themes found in a channel's recent comments (rebuilt about once a day by the worker)."""

    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    channel_id: Mapped[str] = mapped_column(ForeignKey("channels.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    rank: Mapped[int] = mapped_column(Integer, default=0)
    label: Mapped[str] = mapped_column(String(120), default="")
    keywords: Mapped[str | None] = mapped_column(String(300), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    share: Mapped[float] = mapped_column(Float, default=0)  # of the channel's analysed comments
    sentiment: Mapped[float | None] = mapped_column(Float, nullable=True)  # -1 .. +1
    negative_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    recent: Mapped[int] = mapped_column(Integer, default=0)  # comments in the last 14 days
    trend_pct: Mapped[float | None] = mapped_column(Float, nullable=True)  # change in share vs the 14 days before
    weekly: Mapped[str] = mapped_column(Text, default="{}")  # {"2026-10-26": 12, ...}
    examples: Mapped[str] = mapped_column(Text, default="[]")


class LlmUsage(Base):
    """Requests sent to each free AI model per day, so we stay under free limits."""

    __tablename__ = "llm_usage"

    day: Mapped[str] = mapped_column(String(10), primary_key=True)  # Pacific date
    model_key: Mapped[str] = mapped_column(String(150), primary_key=True)  # provider/model
    requests: Mapped[int] = mapped_column(Integer, default=0)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    exhausted: Mapped[bool] = mapped_column(Boolean, default=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class QuotaUsage(Base):
    """YouTube API units spent per (Pacific time) day."""

    __tablename__ = "quota_usage"

    day: Mapped[str] = mapped_column(String(10), primary_key=True)  # YYYY-MM-DD, Pacific time
    units: Mapped[int] = mapped_column(Integer, default=0)


class SchemaMeta(Base):
    """Remembers which table layout the database already has, so startup is one query."""

    __tablename__ = "schema_meta"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class RunLog(Base):
    __tablename__ = "run_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(20))  # sync | analyze
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)


def make_engine(url: str) -> Engine:
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    if engine.dialect.name == "postgresql":
        from sqlalchemy import event

        @event.listens_for(engine, "connect")
        def _no_time_limit(dbapi_conn, _record):  # the background job's big batches may take longer than 25 s
            cur = dbapi_conn.cursor()
            cur.execute("SET statement_timeout = 0")
            cur.close()
            dbapi_conn.commit()
    return engine


def guard_website_queries(engine: Engine) -> None:
    """Database-side safety net: any query from the website that runs longer than WEB_STATEMENT_TIMEOUT
    (default 25 s) is stopped, so one slow page (or an old copy of the site) can't clog the database.
    Set as the role's default; the background job turns it off for its own connections (make_engine)."""
    if engine.dialect.name != "postgresql":
        return
    import os
    import re

    from sqlalchemy import text
    limit = os.environ.get("WEB_STATEMENT_TIMEOUT", "25s")
    if not re.fullmatch(r"\d+(ms|s|min)?", limit):
        return
    try:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER ROLE CURRENT_USER SET statement_timeout = '{limit}'"))
    except Exception as e:  # never block the job over this
        import logging
        logging.getLogger(__name__).warning("Could not set the website query time limit: %s", e)


def schema_fingerprint() -> str:
    import hashlib

    parts = sorted(f"{t.name}.{c.name}:{c.type}" for t in Base.metadata.sorted_tables for c in t.columns)
    parts += sorted(f"idx:{i.name}" for t in Base.metadata.sorted_tables for i in t.indexes)
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]


def init_db(engine: Engine) -> None:
    """Create/upgrade tables. Fast path: one query when the layout is already current
    (each query to a distant database costs ~0.2 s, and every command calls this)."""
    from sqlalchemy import text

    fingerprint = schema_fingerprint()
    try:
        with engine.connect() as conn:
            current = conn.execute(text("SELECT value FROM schema_meta WHERE key = 'layout'")).scalar()
        if current == fingerprint:
            return
    except Exception:  # table missing on a brand-new database
        pass
    Base.metadata.create_all(engine)
    try:
        _add_missing_columns(engine)
        _drop_retired_indexes(engine)
        _lock_public_api(engine)
    except Exception as e:
        if "lock timeout" not in str(e):
            raise
        # A table was busy. Skip for now (the website keeps working); the next run tries again.
        import logging
        logging.getLogger(__name__).warning("Table upgrade postponed (a table was busy): %s", str(e).splitlines()[0])
        return
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM schema_meta WHERE key = 'layout'"))
        conn.execute(text("INSERT INTO schema_meta (key, value) VALUES ('layout', :v)"), {"v": fingerprint})


# Indexes on the big comments table, built CONCURRENTLY (no locks: reads and writes carry on while
# they build). Checked on every run with one catalog query; built only when missing.
EXTRA_INDEXES = {
    # "What should the AI read next": newest unread first (matches ORDER BY published_at DESC NULLS LAST).
    "ix_comments_ai_next": "ON comments (published_at DESC NULLS LAST) WHERE ai_at IS NULL",
    # Same for the sentiment model's queue.
    "ix_comments_analyze_next": "ON comments (published_at DESC) WHERE analyzed_at IS NULL",
    # Replies of a comment (the creator-reply rate, conversations).
    "ix_comments_parent": "ON comments (parent_id, author_channel_id) WHERE parent_id IS NOT NULL",
    # Commenter pages and loyal-viewer counts.
    "ix_comments_author": "ON comments (channel_id, author_channel_id)",
    # "Newest comments" lists (Overview, channel pages, Glance, Comments): ORDER BY published_at DESC NULLS LAST.
    # Without these the database sorted every comment of the channel on each visit (4-7 s on 770k comments).
    "ix_comments_channel_newest": "ON comments (channel_id, published_at DESC NULLS LAST)",
    "ix_comments_newest": "ON comments (published_at DESC NULLS LAST)",
}

# Unused duplicates, removed without blocking writers (ix_comments_ai_next does the same job).
DROP_CONCURRENTLY = ["ix_comments_ai_pending"]


def ensure_extra_indexes(engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return
    import logging

    from sqlalchemy import text

    with engine.connect() as conn:
        rows = conn.execute(text("SELECT indexname, (SELECT indisvalid FROM pg_index WHERE indexrelid = "
                                 "(quote_ident(schemaname) || '.' || quote_ident(indexname))::regclass) AS valid "
                                 "FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'comments'")).all()
    have = {r[0]: r[1] for r in rows}
    for name in DROP_CONCURRENTLY:  # first, so the space is free for the new ones
        if name in have:
            try:
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                    conn.execute(text("SET lock_timeout = '3s'"))
                    conn.execute(text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
                logging.getLogger(__name__).info("Dropped unused index %s", name)
            except Exception as e:
                logging.getLogger(__name__).warning("Index %s not dropped yet: %s", name, str(e).splitlines()[0])
    for name, spec in EXTRA_INDEXES.items():
        if have.get(name) is True:
            continue
        try:
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                if name in have:  # a build that was interrupted leaves an unusable index behind
                    conn.execute(text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
                conn.execute(text(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} {spec}"))
            logging.getLogger(__name__).info("Built index %s", name)
        except Exception as e:  # never stop the job over an index; the next run tries again
            logging.getLogger(__name__).warning("Index %s not built yet: %s", name, str(e).splitlines()[0])


RETIRED_INDEXES = ["ix_comments_video_id", "ix_comments_parent_id", "ix_comments_language",
                   "ix_comments_sentiment", "ix_comments_emotion"]


def _drop_retired_indexes(engine: Engine) -> None:
    """Indexes removed to save space (about 200 bytes per comment)."""
    from sqlalchemy import text

    with engine.begin() as conn:
        have = set(conn.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).scalars()) \
            if engine.dialect.name == "postgresql" else set(RETIRED_INDEXES)
        for name in RETIRED_INDEXES:
            if name in have:
                conn.execute(text(f"DROP INDEX IF EXISTS {name}"))


def _lock_public_api(engine: Engine) -> None:
    """Supabase exposes tables in the `public` schema through its REST API (the
    "publishable"/anon key). Row Level Security with no policies blocks that route
    entirely. The app itself connects as the table owner, which RLS does not restrict."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import text

    with engine.connect() as conn:  # look first: ALTER TABLE locks the table even when nothing changes
        off = set(conn.execute(text("SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace "
                                    "AND relkind = 'r' AND NOT relrowsecurity")).scalars())
    for table in Base.metadata.sorted_tables:
        if table.name in off:
            with engine.begin() as conn:
                conn.execute(text("SET LOCAL lock_timeout = '3s'"))
                conn.execute(text(f'ALTER TABLE "{table.name}" ENABLE ROW LEVEL SECURITY'))


def _add_missing_columns(engine: Engine) -> None:
    """Tiny migration: add columns introduced by newer versions to existing tables."""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    for table in Base.metadata.sorted_tables:
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name not in existing:
                col_type = col.type.compile(dialect=engine.dialect)
                with engine.begin() as conn:
                    if engine.dialect.name == "postgresql":
                        # ALTER TABLE needs the table to itself. If something is using it, waiting would make
                        # every website query on that table queue behind us, so give up after 3 s (next run retries).
                        conn.execute(text("SET LOCAL lock_timeout = '3s'"))
                    conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {col_type}'))


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def upsert(
    session: Session,
    model: type[Base],
    rows: Sequence[dict],
    key_cols: Iterable[str],
    update_cols: Iterable[str],
) -> None:
    """Insert rows, updating `update_cols` when the primary key already exists.

    One round trip per batch, which matters when the database is far away (Supabase).
    """
    if not rows:
        return
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:  # pragma: no cover - other databases are not supported
        raise RuntimeError(f"Unsupported database: {dialect}")

    # De-duplicate within the batch (Postgres rejects the same key twice in one statement).
    keys = list(key_cols)
    unique: dict[tuple, dict] = {}
    for row in rows:
        unique[tuple(row[k] for k in keys)] = row
    stmt = insert(model).values(list(unique.values()))
    update_cols = list(update_cols)
    if update_cols:
        stmt = stmt.on_conflict_do_update(
            index_elements=keys,
            set_={c: getattr(stmt.excluded, c) for c in update_cols},
        )
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=keys)
    session.execute(stmt)
