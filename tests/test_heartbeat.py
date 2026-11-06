import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from ytanalytics import heartbeat


@pytest.fixture
def session():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    with sessionmaker(bind=engine)() as s:
        yield s


def test_no_worker_means_not_alive(session):
    assert heartbeat.alive(session) is False


def test_heartbeat_makes_worker_alive_and_counts_cycles(session):
    heartbeat.beat(session, "space", "cycle start", new_cycle=True)
    heartbeat.beat(session, "space", "sync exit 0")
    assert heartbeat.alive(session, minutes=30) is True
    from sqlalchemy import text
    cycles, info = session.execute(text("SELECT cycles, info FROM worker_heartbeat WHERE name = 'space'")).one()
    assert cycles == 1 and info == "sync exit 0"
