"""Tell the website that results changed, so every page section follows the latest analysis.

The website keeps saved results (panel_cache) for its heavier sections and the engine refreshes them on a
schedule. When a worker job changes what those sections are built from (archive reading, nightly training,
change alerts), it marks the affected saved results out of date: they're refreshed first on the engine's next
turns, and a page opened in the meantime works them out fresh instead of showing old numbers.
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


def mark_stale(session: Session, channel_ids=(), patterns=()) -> int:
    """Age saved results by 30 days: those containing a channel id, or matching LIKE patterns."""
    if session.get_bind().dialect.name != "postgresql":
        return 0
    conds, params = [], {}
    for i, c in enumerate(channel_ids):
        conds.append(f"key like :c{i}")
        params[f"c{i}"] = f"%{c}%"
    for i, p in enumerate(patterns):
        conds.append(f"key like :p{i}")
        params[f"p{i}"] = p
    if not conds:
        return 0
    try:
        n = session.execute(text(f"""update panel_cache set computed_at = computed_at - interval '30 days'
            where key not like 'lock:%' and ({' or '.join(conds)})"""), params).rowcount
        session.commit()
        log.info("Marked %d saved page sections for refresh", n)
        return n or 0
    except Exception as e:  # the table appears with the website's first visit
        session.rollback()
        log.info("No saved page sections to refresh (%s)", str(e).splitlines()[0])
        return 0
