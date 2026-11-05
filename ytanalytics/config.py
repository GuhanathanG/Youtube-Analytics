"""Settings, read from environment variables (GitHub Actions secrets / local .env)."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    return int(value) if value else default


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    database_url: str
    youtube_api_key: str
    # YouTube gives 10,000 quota units per day (resets at midnight Pacific time).
    # We stop a little below that so a manual run never gets blocked.
    daily_quota: int
    # Max minutes a single sync / analyze run may take (keeps GitHub Actions usage low).
    max_run_minutes: float
    # Videos published in the last N days are checked for new comments on every run.
    live_window_days: int
    # Fetch every reply of a thread (costs extra quota) instead of only the first 5.
    fetch_all_replies: bool
    sentiment_model: str
    analyze_batch_size: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_url=normalize_db_url(os.environ.get("DATABASE_URL", "sqlite:///ytanalytics.db")),
            youtube_api_key=os.environ.get("YOUTUBE_API_KEY", "").strip(),
            daily_quota=_int("DAILY_QUOTA", 9500),
            max_run_minutes=float(os.environ.get("MAX_RUN_MINUTES", "").strip() or 20),
            live_window_days=_int("LIVE_WINDOW_DAYS", 14),
            fetch_all_replies=_bool("FETCH_ALL_REPLIES", True),
            sentiment_model=os.environ.get(
                "SENTIMENT_MODEL", "cardiffnlp/twitter-xlm-roberta-base-sentiment"
            ),
            analyze_batch_size=_int("ANALYZE_BATCH_SIZE", 64),
        )


def normalize_db_url(url: str) -> str:
    """Supabase/Neon hand out `postgres://` URLs; point SQLAlchemy at the psycopg 3 driver."""
    url = url.strip()
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url
