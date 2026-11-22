"""Live training progress for the Model Lab: each job writes where it is (phase, step of total, latest loss) into one
small row per job in the main database; the Lab polls it every few seconds. Never fails the job it reports on."""
from __future__ import annotations

import json
import logging
import os
import time

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


class Progress:
    def __init__(self, session: Session | None, job: str, every: float = 8.0):
        self.s, self.job, self.every = session, job, every
        self.last = 0.0
        self.losses: list[float] = []
        self.run = os.environ.get("GITHUB_RUN_ID", "local")
        if session is None:
            return
        try:
            session.execute(text("""create table if not exists training_progress (job text primary key, run_id text, phase text,
                step integer, total integer, loss double precision, history text, note text, started_at timestamp, updated_at timestamp)"""))
            if session.bind is not None and session.bind.dialect.name == "postgresql":
                session.execute(text("alter table training_progress enable row level security"))
            session.execute(text("""insert into training_progress (job, run_id, phase, step, total, loss, history, note, started_at, updated_at)
                values (:j, :r, 'starting', 0, null, null, '[]', null, now() at time zone 'utc', now() at time zone 'utc')
                on conflict (job) do update set run_id = excluded.run_id, phase = 'starting', step = 0, total = null, loss = null,
                history = '[]', note = null, started_at = excluded.started_at, updated_at = excluded.updated_at"""), {"j": job, "r": self.run})
            session.commit()
        except Exception as e:
            session.rollback()
            log.warning("progress off: %s", str(e).splitlines()[0][:160])
            self.s = None

    def update(self, phase: str, step: int | None = None, total: int | None = None, loss: float | None = None,
               note: str | None = None, force: bool = False) -> None:
        if loss is not None:
            self.losses.append(round(float(loss), 4))
        if self.s is None or (not force and time.monotonic() - self.last < self.every):
            return
        self.last = time.monotonic()
        # Keep at most ~120 points of the loss curve (evenly thinned).
        hist = self.losses if len(self.losses) <= 120 else self.losses[:: max(1, len(self.losses) // 120)]
        try:
            self.s.execute(text("""update training_progress set phase = :p, step = coalesce(:st, step), total = coalesce(:t, total),
                loss = coalesce(:l, loss), history = :h, note = coalesce(:n, note), updated_at = now() at time zone 'utc' where job = :j"""),
                {"p": phase, "st": step, "t": total, "l": None if loss is None else float(loss), "h": json.dumps(hist), "n": note, "j": self.job})
            self.s.commit()
        except Exception as e:
            self.s.rollback()
            log.warning("progress update skipped: %s", str(e).splitlines()[0][:160])

    def done(self, note: str | None = None, failed: bool = False) -> None:
        self.update("failed" if failed else "done", note=note, force=True)
