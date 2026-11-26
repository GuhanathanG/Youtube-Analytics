"""Watchdog: starts skipped jobs, retries a failure once, alerts after two, keeps schedules switched on."""
from datetime import datetime, timedelta, timezone

from ytanalytics.watchdog import JOBS, Job, decide, run

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc)
JOB = Job("training.yml", "Training channels", 6, 3)


def r(hours_ago, conclusion="success", status="completed", id=1):
    return {"id": id, "status": status, "conclusion": conclusion, "created_at": (NOW - timedelta(hours=hours_ago)).isoformat()}


def test_on_schedule_and_running():
    assert decide(JOB, [r(2)], NOW)[0] == "ok"
    assert decide(JOB, [r(20, status="in_progress", conclusion=None), r(30)], NOW)[0] == "wait"


def test_skipped_timer_and_never_run_start_it():
    assert decide(JOB, [r(10)], NOW)[0] == "start"
    assert decide(JOB, [], NOW)[0] == "start"


def test_one_failure_retried_after_30_minutes():
    assert decide(JOB, [r(0.2, "failure"), r(6)], NOW)[0] == "wait"
    assert decide(JOB, [r(1, "failure"), r(6)], NOW)[0] == "retry"


def test_two_failures_alert_then_wait_for_next_slot():
    assert decide(JOB, [r(1, "failure"), r(2, "timed_out")], NOW)[0] == "alert"
    assert decide(JOB, [r(10, "failure"), r(11, "failure")], NOW)[0] == "start"
    assert decide(JOB, [r(10, "cancelled")], NOW)[0] == "start"


class FakeGitHub:
    def __init__(self, runs, states=None):
        self._runs, self.states, self.enabled, self.dispatched = runs, states or {}, [], []

    def state(self, file):
        return self.states.get(file, "active")

    def enable(self, file):
        self.enabled.append(file)

    def runs(self, file):
        return self._runs.get(file, [r(1)])

    def dispatch(self, file, ref="main"):
        self.dispatched.append(file)


def test_run_dispatches_and_reenables():
    gh = FakeGitHub({"model.yml": [r(40)], "reader.yml": [r(1, "failure"), r(200)]},
                    states={"training.yml": "disabled_inactivity"})
    out = run(None, gh=gh, now=NOW, keep_alive=False)
    assert gh.dispatched == ["model.yml", "reader.yml"]
    assert gh.enabled == ["training.yml"] and any("switched back on" in o for o in out)
    run(None, gh=gh, now=NOW, keep_alive=True)
    assert len(gh.enabled) == 1 + len(JOBS) + 1  # daily re-confirm covers every schedule incl. sync


def test_analyst_due_needs_ten_percent_more(tmp_path):
    import json

    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from ytanalytics.analyst import due

    eng = create_engine("sqlite://")
    with Session(eng) as s:
        s.execute(text("create table local_models (name text primary key, trained_at text, metrics text, payload text)"))
        assert due(s, {"train": 800})[0]
        s.execute(text("insert into local_models values ('pulse-analyst', '', :m, '{}')"), {"m": json.dumps({"train_pairs": 800})})
        assert not due(s, {"train": 850})[0]
        assert due(s, {"train": 880})[0]



def test_reader_due_counts_main_and_archive_reads():
    import json

    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from ytanalytics.reader import due, labelled_total

    eng = create_engine("sqlite://")
    with Session(eng) as s:
        s.execute(text("create table local_models (name text primary key, trained_at text, metrics text, payload text)"))
        s.execute(text("create table comments (id text, ai_at text, ai_model text)"))
        s.execute(text("create table archive_stats (ai_read integer)"))
        assert due(s, min_new=3)[0]  # no model yet
        s.execute(text("insert into local_models values ('pulse-reader', '', '{}', '{}')"))
        assert due(s, min_new=3)[0]  # older record without a count: train once
        s.execute(text("insert into comments values ('a', 'x', 'gemini'), ('b', 'x', 'rules/v1'), ('c', null, null)"))
        s.execute(text("insert into archive_stats values (10)"))
        assert labelled_total(s) == 11
        s.execute(text("update local_models set metrics = :m"), {"m": json.dumps({"labelled_total": 10})})
        assert not due(s, min_new=3)[0]
        s.execute(text("update archive_stats set ai_read = 12"))
        assert due(s, min_new=3)[0]


def test_score_history_records_runs_and_never_raises():
    from datetime import datetime

    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from ytanalytics.runlog import record

    eng = create_engine("sqlite://")
    with Session(eng) as s:
        record(s, "pulse-reader", 0.733, "mood macro-F1", adopted=True, at=datetime(2026, 11, 24))
        record(s, "pulse-reader", 0.722, "mood macro-F1", adopted=False, baseline=0.733, note="worse", at=datetime(2026, 11, 25))
        record(s, "pulse-reader", 0.722, "mood macro-F1", adopted=False, at=datetime(2026, 11, 25))  # same run twice: kept once
        rows = s.execute(text("select score, adopted, baseline from model_runs order by run_at")).all()
        assert [(round(r[0], 3), bool(r[1])) for r in rows] == [(0.733, True), (0.722, False)] and rows[1][2] == 0.733
        s.execute(text("drop table model_runs"))
        s.execute(text("create view model_runs as select 1 as x"))  # broken table: logged, not raised
        record(s, "x", 1, "y", adopted=True)


def test_local_writer_parses_and_cloud_replaces_local_insights():
    import json

    from ytanalytics.analyst_local import MODEL_TAG, parse

    assert parse('noise {"summary": "Fans loved it", "mood": "positive", "bogus": 1} tail')["summary"] == "Fans loved it"
    assert "bogus" not in parse('{"summary": "x"}') and parse('{"summary": ""}') is None and parse("no json") is None
    assert MODEL_TAG.startswith("local/") and json.loads(json.dumps(parse('{"summary": "தமிழ் ok"}')))
