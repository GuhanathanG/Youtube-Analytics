"""Score history: one row per training run of each of our own models, adopted or not, so the Model Lab can show
whether each model is improving (model_runs table in the main database)."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


def ensure_table(session: Session) -> None:
    session.execute(text("""create table if not exists model_runs (
        model text not null, run_at timestamp not null, score double precision, score_name text, baseline double precision,
        adopted boolean not null default false, metrics text, note text, primary key (model, run_at))"""))
    if session.get_bind().dialect.name == "postgresql":
        session.execute(text("alter table model_runs enable row level security"))
    session.commit()


def record(session: Session, model: str, score: float | None, score_name: str, *, adopted: bool, metrics: dict | None = None,
           baseline: float | None = None, note: str | None = None, at: datetime | None = None) -> None:
    """Never fails the training job: the history is a nice-to-have."""
    try:
        ensure_table(session)
        at = (at or datetime.now(timezone.utc)).replace(tzinfo=None, microsecond=0)
        session.execute(text("""insert into model_runs (model, run_at, score, score_name, baseline, adopted, metrics, note)
            values (:m, :t, :s, :n, :b, :a, :j, :note) on conflict (model, run_at) do nothing"""),
            {"m": model, "t": at, "s": None if score is None else float(score), "n": score_name,
             "b": None if baseline is None else float(baseline), "a": bool(adopted),
             "j": json.dumps(metrics or {}, default=str)[:20000], "note": note})
        session.commit()
    except Exception as e:  # noqa: BLE001
        session.rollback()
        log.warning("Score history not saved for %s: %s", model, str(e).splitlines()[0])
