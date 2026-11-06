"""Keep GitHub Actions usage inside the free monthly minutes of a private repository.

Each workflow run records how long it took (`record-job`). Before working, a run asks
`plan_minutes` how much time it may use: the minutes left this month divided by the
runs left this month. Quiet runs finish early, so their unused minutes roll over to
busier runs (e.g. while a big channel's history is still downloading).

MONTHLY_MINUTES_BUDGET=0 switches the limit off (use that once the repo is public).
"""
from __future__ import annotations

import calendar
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import RunLog, utcnow


@dataclass
class Plan:
    sync: float
    analyze: float
    ai: float
    used_this_month: int
    budget: int
    runs_left: int

    def as_outputs(self, now_epoch: float | None = None) -> str:
        """Lines for $GITHUB_OUTPUT. Each step gets an end time (unix seconds) rather than a
        fixed length, so time a quick step does not use flows on to the next step."""
        import time as _time

        t0 = now_epoch if now_epoch is not None else _time.time()
        sync_until = t0 + self.sync * 60
        analyze_until = sync_until + self.analyze * 60
        ai_until = analyze_until + self.ai * 60
        return "\n".join([
            f"sync_until={sync_until:.0f}",
            f"analyze_until={analyze_until:.0f}",
            f"ai_until={ai_until:.0f}",
            f"work_minutes={self.sync + self.analyze + self.ai:.1f}",
            f"used={self.used_this_month}",
            f"budget={self.budget}",
        ])


def minutes_used_this_month(session: Session, now: datetime | None = None) -> int:
    now = now or utcnow()
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    jobs = session.execute(
        select(RunLog.started_at, RunLog.finished_at)
        .where(RunLog.kind == "job", RunLog.started_at >= start)
    ).all()
    total = 0
    for started, finished in jobs:
        if finished:
            # GitHub rounds every job up to the next whole minute.
            total += max(1, math.ceil((finished - started).total_seconds() / 60))
    return total


def plan_minutes(session: Session, env: dict | None = None, now: datetime | None = None) -> Plan:
    env = env if env is not None else os.environ
    now = now or utcnow()
    budget = int(env.get("MONTHLY_MINUTES_BUDGET", "1700") or 0)
    runs_per_day = max(1, int(env.get("RUNS_PER_DAY", "12") or 12))
    overhead = float(env.get("RUN_OVERHEAD_MINUTES", "2.5") or 2.5)  # setup + installs
    max_work = float(env.get("MAX_WORK_MINUTES", "25") or 25)

    days_in_month = calendar.monthrange(now.year, now.month)[1]
    hours_left = (days_in_month - now.day) * 24 + (24 - now.hour)
    runs_left = max(1, math.ceil(hours_left * runs_per_day / 24))
    used = minutes_used_this_month(session, now)

    if budget <= 0:
        work = max_work
    else:
        work = (budget - used) / runs_left - overhead
        work = max(1.5, min(max_work, work))  # always leave room to catch new comments

    # With unlimited minutes (public repository) runs come every 30 minutes, so each run has little
    # new to download and the AI lane gets the biggest share; otherwise YouTube downloads come first.
    shares = (0.35, 0.15, 0.50) if budget <= 0 else (0.45, 0.25, 0.30)
    return Plan(
        sync=round(max(1.0, work * shares[0]), 1),
        analyze=round(max(0.5, work * shares[1]), 1),
        ai=round(max(0.5, work * shares[2]), 1),
        used_this_month=used,
        budget=budget,
        runs_left=runs_left,
    )


def record_job(session: Session, started_epoch: float, status: str = "ok") -> None:
    started = datetime.fromtimestamp(started_epoch, tz=timezone.utc).replace(tzinfo=None)
    session.add(RunLog(kind="job", started_at=started, finished_at=utcnow(), status=status))
    session.commit()
