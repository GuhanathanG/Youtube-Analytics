"""Engine-stopped alarm, checked by the GitHub background job.

The website's 2-minute engine raises its own health alerts (web/lib/alerts.ts), but it can't report
that it has stopped. This job can: if the engine hasn't run for ENGINE_STALE_MINUTES (default 15), it
sends one Telegram message per 6-hour window (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets in GitHub).
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


def engine_age_minutes(session: Session) -> float | None:
    try:
        at = session.execute(text("SELECT last_cron_at FROM live_state WHERE id = 1")).scalar()
    except Exception:
        session.rollback()
        return None
    if at is None:
        return None
    if isinstance(at, str):  # SQLite returns text
        at = datetime.fromisoformat(at)
    return (datetime.now(timezone.utc).replace(tzinfo=None) - at).total_seconds() / 60


def send_telegram(message: str) -> bool:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    base = os.environ.get("TELEGRAM_API_BASE", "https://api.telegram.org")
    req = urllib.request.Request(f"{base}/bot{token}/sendMessage", data=json.dumps({"chat_id": chat, "text": message}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception as e:  # never fail the job over an alert
        log.warning("Telegram alert not sent: %s", e)
        return False


def check_engine(session: Session) -> str:
    age = engine_age_minutes(session)
    limit = float(os.environ.get("ENGINE_STALE_MINUTES", "15"))
    if age is None or age < limit:
        return "engine ok" if age is not None else "engine not set up yet"
    now = datetime.now(timezone.utc)
    key = f"health:engine-stopped:{now:%Y-%m-%d}-{now.hour // 6}"
    title = "🛑 Engine stopped"
    body = (f"The 2-minute engine last ran {int(age)} minutes ago. New comments and live checks are paused. "
            "Check that the cron-job.org timer is enabled and the site opens.")
    try:
        inserted = session.execute(text(
            "INSERT INTO alerts (kind, key, title, body, link) VALUES ('health', :k, :t, :b, '/manage') "
            "ON CONFLICT (key) DO NOTHING RETURNING id"), {"k": key, "t": title, "b": body}).first()
        session.commit()
    except Exception:  # alerts table not created yet (the website creates it)
        session.rollback()
        inserted = True
    if inserted:
        send_telegram(f"{title}\n{body}")
        return f"engine stopped {int(age)} min ago: alert sent"
    return f"engine stopped {int(age)} min ago: already alerted"
