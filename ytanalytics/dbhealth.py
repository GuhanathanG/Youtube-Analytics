"""Database health report: where the time goes. Read-only. Prints no comment text or passwords
(query texts from pg_stat_statements have their values replaced by $1, $2 …)."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


def _rows(session: Session, sql: str):
    try:
        return session.execute(text(sql)).mappings().all()
    except Exception as e:  # e.g. extension missing
        session.rollback()
        return [{"error": str(e).splitlines()[0][:200]}]


def _print(title: str, rows) -> None:
    print(f"\n=== {title} ===")
    for r in rows:
        print(" | ".join(f"{k}={(' '.join(str(v).split()))[:220]}" for k, v in dict(r).items()))


def report(session: Session) -> None:
    session.execute(text("SET statement_timeout = '60s'"))
    _print("Database size", _rows(session, "select pg_size_pretty(pg_database_size(current_database())) as size, "
                                           "(select setting from pg_settings where name = 'max_connections') as max_conn, "
                                           "(select setting from pg_settings where name = 'shared_buffers') as shared_buffers_8k"))
    _print("Cache hit ratio (should be > 0.99)", _rows(session,
        "select round(sum(heap_blks_hit)::numeric / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 4) as table_hit, "
        "(select round(sum(idx_blks_hit)::numeric / nullif(sum(idx_blks_hit) + sum(idx_blks_read), 0), 4) from pg_statio_user_indexes) as index_hit "
        "from pg_statio_user_tables"))
    _print("Largest tables", _rows(session,
        "select relname as table, n_live_tup as rows, n_dead_tup as dead, pg_size_pretty(pg_total_relation_size(relid)) as size, "
        "seq_scan, idx_scan, last_autovacuum, last_autoanalyze from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 15"))
    _print("Connections by state", _rows(session,
        "select coalesce(application_name, '') as app, state, count(*) as n, max(now() - query_start) as longest "
        "from pg_stat_activity where datname = current_database() group by 1, 2 order by 3 desc"))
    _print("Running right now (> 1 s)", _rows(session,
        "select pid, now() - query_start as running, wait_event_type, wait_event, left(query, 200) as query "
        "from pg_stat_activity where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid() "
        "and now() - query_start > interval '1 second' order by query_start limit 15"))
    _print("Waiting for locks", _rows(session,
        "select a.pid, now() - a.query_start as waiting, l.mode, l.relation::regclass as rel, left(a.query, 150) as query "
        "from pg_locks l join pg_stat_activity a on a.pid = l.pid where not l.granted limit 15"))
    stmts = ("select calls, round(total_exec_time::numeric / 1000, 1) as total_s, round(mean_exec_time::numeric, 1) as mean_ms, "
             "round(max_exec_time::numeric, 1) as max_ms, rows, left(query, 260) as query from extensions.pg_stat_statements "
             "where dbid = (select oid from pg_database where datname = current_database()) ")
    _print("Slowest queries in total time", _rows(session, stmts + "order by total_exec_time desc limit 20"))
    _print("Slowest queries per call (called 5+ times)", _rows(session, stmts + "and calls >= 5 order by mean_exec_time desc limit 20"))
    _print("Indexes never used", _rows(session,
        "select relname as table, indexrelname as index, pg_size_pretty(pg_relation_size(indexrelid)) as size "
        "from pg_stat_user_indexes where idx_scan = 0 order by pg_relation_size(indexrelid) desc limit 10"))
