"""Heartbeat of the always-on worker (e.g. a free Hugging Face Space).

The worker writes a heartbeat after every step. While it is fresh, the GitHub Actions job and the
website's backup scheduler stand aside, so the same work isn't done twice.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

DDL = ("CREATE TABLE IF NOT EXISTS worker_heartbeat (name VARCHAR(40) PRIMARY KEY, at TIMESTAMP NOT NULL, "
       "started_at TIMESTAMP, cycles INTEGER NOT NULL DEFAULT 0, info TEXT)")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def beat(session: Session, name: str, info: str = "", new_cycle: bool = False) -> None:
    session.execute(text(DDL))
    if session.get_bind().dialect.name == "postgresql":
        session.execute(text("ALTER TABLE worker_heartbeat ENABLE ROW LEVEL SECURITY"))
    row = session.execute(text("SELECT cycles FROM worker_heartbeat WHERE name = :n"), {"n": name}).first()
    if row is None:
        session.execute(text("INSERT INTO worker_heartbeat (name, at, started_at, cycles, info) VALUES (:n, :at, :at, :c, :i)"),
                        {"n": name, "at": _now(), "c": 1 if new_cycle else 0, "i": info[:500]})
    else:
        session.execute(text("UPDATE worker_heartbeat SET at = :at, cycles = cycles + :c, info = :i WHERE name = :n"),
                        {"n": name, "at": _now(), "c": 1 if new_cycle else 0, "i": info[:500]})
    session.commit()


def alive(session: Session, minutes: float = 30) -> bool:
    """True if any always-on worker reported within `minutes` (a full cycle can take ~25 minutes)."""
    try:
        at = session.execute(text("SELECT max(at) FROM worker_heartbeat")).scalar()
    except Exception:
        session.rollback()
        return False
    if at is None:
        return False
    if isinstance(at, str):
        at = datetime.fromisoformat(at)
    return (_now() - at).total_seconds() < minutes * 60
