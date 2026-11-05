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
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    channel_id: Mapped[str] = mapped_column(String(64), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    author_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    author_channel_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    text: Mapped[str] = mapped_column(Text, default="")
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    reply_count: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Filled in by the analyze step.
    language: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    sentiment: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    sentiment_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # confidence 0..1
    sentiment_value: Mapped[float | None] = mapped_column(Float, nullable=True)  # -1 (neg) .. +1 (pos)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    analyzer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Filled in by the AI (LLM) pass. When present, `sentiment` above holds the AI's label
    # and `sentiment_source` is "ai"; otherwise it is "model" (the local classifier).
    sentiment_source: Mapped[str | None] = mapped_column(String(10), nullable=True)
    emotion: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
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
    return create_engine(url, **kwargs)


def init_db(engine: Engine) -> None:
    Base.metadata.create_all(engine)
    _add_missing_columns(engine)


def _add_missing_columns(engine: Engine) -> None:
    """Tiny migration: add columns introduced by newer versions to existing tables."""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing:
                    col_type = col.type.compile(dialect=engine.dialect)
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
