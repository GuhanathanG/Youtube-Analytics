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
    # Pages (50 videos each) of a channel's upload history to read per run before
    # moving on to comments; the rest follows on later runs.
    upload_pages_per_run: int = 4

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
            upload_pages_per_run=_int("UPLOAD_PAGES_PER_RUN", 4),
        )


def normalize_db_url(url: str) -> str:
    """Supabase/Neon hand out `postgres://` URLs; point SQLAlchemy at the psycopg 3 driver."""
    url = url.strip()
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def mask_password(url: str) -> str:
    """postgresql://user:secret@host -> postgresql://user:•••@host"""
    import re

    return re.sub(r"(://[^:/@]+:)[^@]*(@)", r"\1•••\2", url or "")


def diagnose_database_url(url: str, error: Exception | None) -> list[str]:
    """Plain-English reasons why DATABASE_URL does not work. Empty list = looks fine."""
    import re

    url = (url or "").strip()
    if error is None:
        if not url:
            return ["`DATABASE_URL` is missing from the app's Secrets."]
        if not url.startswith(("postgresql://", "postgres://", "sqlite")):
            return [f"`DATABASE_URL` should start with `postgresql://`; it currently starts with "
                    f"`{url[:15]}`. Check the quote marks: `DATABASE_URL = \"postgresql://...\"`."]
        problems = []
        if "[YOUR-PASSWORD]" in url or re.search(r":\[.*\]@", url):
            problems.append("The address still contains `[YOUR-PASSWORD]` or square brackets. Replace "
                            "`[YOUR-PASSWORD]` (brackets included) with your Supabase database password.")
        if url.count("@") > 1:
            problems.append("The password contains an `@`, which breaks the address. In Supabase, go to "
                            "**Project Settings → Database → Reset database password** and choose one with "
                            "only letters and numbers.")
        if "supabase.co:5432" in url and "pooler" not in url:
            problems.append("This is the **Direct connection** address. In Supabase → **Connect** → "
                            "**Direct**, pick **Session pooler** and copy that address instead.")
        return problems

    msg = str(getattr(error, "orig", None) or error).lower()
    shown = mask_password(url)
    if "password authentication failed" in msg:
        reason = ("Supabase rejected the **password**. Reset it in **Project Settings → Database → "
                  "Reset database password** (letters and numbers only) and put the new one in the address.")
    elif "tenant or user not found" in msg:
        reason = ("Supabase doesn't recognise the **user/project part** (`postgres.xxxx`). Copy the "
                  "**Session pooler** address from Supabase again, changing only the password.")
    elif "could not translate host name" in msg or "name or service not known" in msg:
        reason = ("The **server name** after `@` is wrong. Often the password contains a special character "
                  "(`# / ? %`). Use a password with only letters and numbers.")
    elif "timeout" in msg or "unreachable" in msg or "timed out" in msg:
        reason = ("The database didn't answer. Make sure you used the **Session pooler** address "
                  "(`…pooler.supabase.com:5432`), and that the Supabase project isn't paused.")
    else:
        reason = "The database refused the connection."
    return [reason, f"Address being used: `{shown}`",
            f"Technical detail: `{str(getattr(error, 'orig', None) or error)[:300]}`"]
