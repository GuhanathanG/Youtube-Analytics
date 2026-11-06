from datetime import datetime, timedelta, timezone

from sqlalchemy import text

import pytest
from sqlalchemy.pool import StaticPool

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ytanalytics import health


@pytest.fixture
def session():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    with sessionmaker(bind=engine)() as s:
        yield s


def _setup(session, minutes_ago):
    session.execute(text("CREATE TABLE IF NOT EXISTS live_state (id INTEGER PRIMARY KEY, last_cron_at TIMESTAMP)"))
    session.execute(text("CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, key TEXT UNIQUE, "
                         "title TEXT, body TEXT, link TEXT)"))
    at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=minutes_ago)
    session.execute(text("INSERT OR REPLACE INTO live_state (id, last_cron_at) VALUES (1, :at)"), {"at": at})
    session.commit()


def test_engine_ok(session):
    _setup(session, 3)
    assert health.check_engine(session) == "engine ok"


def test_engine_stopped_alerts_once(session, monkeypatch):
    sent = []
    monkeypatch.setattr(health, "send_telegram", lambda m: sent.append(m) or True)
    _setup(session, 40)
    assert "alert sent" in health.check_engine(session)
    assert "already alerted" in health.check_engine(session)
    assert len(sent) == 1 and "Engine stopped" in sent[0]
