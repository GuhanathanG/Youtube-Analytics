"""E9: "something changed" detection on each channel's daily numbers (nightly, in the Prediction engine job).

Two kinds of event, for daily views gained (from subscriber/view snapshots) and daily comment mood:
  * shift — the level stepped up or down and stayed there (change-point detection with the open-source
    `ruptures` library, PELT on the log series; a lasting move of SHIFT_MIN_PCT or more, at least 5 days on each side),
  * spike — one day far outside the previous four weeks (robust z-score with median / MAD).
Only recent events (last 10 days) are saved; each is saved and sent to Telegram once.
The channel page shows them as pins on its timeline.
"""
from __future__ import annotations

import logging
import math
import os
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


def ensure_table(session: Session) -> None:
    session.execute(text("""create table if not exists channel_events (
        channel_id text not null, day date not null, metric text not null, kind text not null,
        before double precision, after double precision, pct double precision, note text,
        created_at timestamp not null, primary key (channel_id, day, metric, kind))"""))
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        session.execute(text("alter table channel_events enable row level security"))
    session.commit()


def find_shift(values: list[float], min_size: int = 5, penalty: float | None = None) -> tuple[int, float, float] | None:
    """Most recent lasting change in the level of a series: (index where the new level starts, mean before, mean after)."""
    if len(values) < min_size * 2:
        return None
    import numpy as np

    y = np.log1p(np.maximum(np.asarray(values, dtype=float), 0))
    pen = penalty if penalty is not None else 3 * math.log(len(y)) * max(float(np.var(np.diff(y))) / 2, 1e-3)
    try:
        import ruptures as rpt

        bkps = rpt.Pelt(model="l2", min_size=min_size, jump=1).fit(y.reshape(-1, 1)).predict(pen=pen)[:-1]
    except ImportError:  # fallback: the single best split
        best, bkps = 0.0, []
        for i in range(min_size, len(y) - min_size + 1):
            gain = len(y) * np.var(y) - i * np.var(y[:i]) - (len(y) - i) * np.var(y[i:])
            if gain > best and gain > pen:
                best, bkps = gain, [i]
    if not bkps:
        return None
    i = bkps[-1]
    prev = bkps[-2] if len(bkps) > 1 else 0
    before, after = float(np.mean(values[prev:i])), float(np.mean(values[i:]))
    return i, before, after


def find_spike(values: list[float], window: int = 28, z: float = 4.0) -> tuple[float, float] | None:
    """Is the last value far outside the previous `window` days? (value, typical)"""
    if len(values) < 10:
        return None
    import numpy as np

    hist = np.asarray(values[-window - 1:-1], dtype=float)
    med = float(np.median(hist))
    mad = float(np.median(np.abs(hist - med))) * 1.4826 or max(1.0, med * 0.1)
    last = float(values[-1])
    return (last, med) if abs(last - med) / mad >= z and abs(last - med) >= max(5.0, med * 0.5) else None


def _daily_views(session: Session, channel_id: str, since: date) -> list[tuple[date, float]]:
    rows = session.execute(text("""select cast(taken_at as date) as d, max(view_count) as v from channel_snapshots
        where channel_id = :c and taken_at >= :s and view_count is not null group by 1 order by 1"""),
                           {"c": channel_id, "s": since - timedelta(days=1)}).all()
    out = []
    for (d0, v0), (d1, v1) in zip(rows, rows[1:]):
        gap = max(1, (d1 - d0).days)
        out.append((d1, max(0.0, float(v1 - v0)) / gap))
    return out


def _daily_mood(session: Session, channel_id: str, since: date) -> list[tuple[date, float]]:
    rows = session.execute(text("""select day, positive, negative from comment_day where channel_id = :c and day >= :s
        and positive + negative >= 5 order by day"""), {"c": channel_id, "s": since}).all()
    return [(r.day, 100.0 * (r.positive - r.negative) / (r.positive + r.negative)) for r in rows]


def detect_changes(session: Session, today: date | None = None, notify=None) -> list[dict]:
    ensure_table(session)
    today = today or datetime.now(timezone.utc).date()
    since = today - timedelta(days=90)
    recent = today - timedelta(days=int(os.environ.get("CHANGE_RECENT_DAYS", "10")))
    min_pct = float(os.environ.get("SHIFT_MIN_PCT", "30"))
    found: list[dict] = []
    channels = session.execute(text("select id, title from channels where active")).all()
    for ch in channels:
        for metric, series in (("views", _daily_views(session, ch.id, since)), ("mood", _daily_mood(session, ch.id, since))):
            if len(series) < 10:
                continue
            days, values = [d for d, _ in series], [v for _, v in series]
            # Mood is a -100..100 score (shift = points); views are counts (shift = %).
            shift = find_shift([v + 101 for v in values] if metric == "mood" else values)
            if shift:
                i, before, after = shift
                if metric == "mood":
                    before, after = before - 101, after - 101
                pct = (after - before) if metric == "mood" else (after - before) / max(before, 1.0) * 100
                big = abs(pct) >= (15 if metric == "mood" else min_pct)
                if big and days[i] >= recent:
                    found.append({"channel_id": ch.id, "title": ch.title, "day": days[i], "metric": metric, "kind": "shift",
                                  "before": before, "after": after, "pct": pct})
            spike = find_spike(values)
            if spike and days[-1] >= recent and metric == "views":
                last, typical = spike
                found.append({"channel_id": ch.id, "title": ch.title, "day": days[-1], "metric": metric, "kind": "spike",
                              "before": typical, "after": last, "pct": (last - typical) / max(typical, 1.0) * 100})
    now = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    fresh = []
    for e in found:
        note = describe(e)
        inserted = session.execute(text("""insert into channel_events (channel_id, day, metric, kind, before, after, pct, note, created_at)
            values (:channel_id, :day, :metric, :kind, :before, :after, :pct, :note, :now) on conflict do nothing returning channel_id"""),
            {**{k: e[k] for k in ("channel_id", "day", "metric", "kind", "before", "after", "pct")}, "note": note, "now": now}).first()
        if inserted:
            fresh.append({**e, "note": note})
    session.commit()
    if notify is None:
        from .health import send_telegram as notify
    for e in fresh:
        notify(f"📈 {e['title']}: {e['note']}")
    log.info("Change detection: %d events (%d new)", len(found), len(fresh))
    return fresh


def describe(e: dict) -> str:
    when = e["day"].strftime("%d %b")
    if e["metric"] == "mood":
        word = "brighter" if e["after"] > e["before"] else "darker"
        return f"comment mood turned {word} from {when} ({e['before']:+.0f} → {e['after']:+.0f} net)."
    if e["kind"] == "spike":
        return f"views jumped on {when}: {e['after']:,.0f} in a day vs a usual {e['before']:,.0f}."
    word = "up" if e["after"] > e["before"] else "down"
    return f"daily views stepped {word} {abs(e['pct']):.0f}% from {when} ({e['before']:,.0f} → {e['after']:,.0f} a day)."

