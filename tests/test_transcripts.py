"""E3 transcripts: stored when YouTube answers, 'none' when there are no captions, back off when blocked."""
from datetime import timedelta

from sqlalchemy import select

from ytanalytics.db import Base, Channel, Video, VideoTranscript, init_db, make_engine, make_session_factory, utcnow
from ytanalytics.transcripts import fetch_transcripts


class IpBlocked(Exception):
    pass


class NoTranscriptFound(Exception):
    pass


class Seg:
    def __init__(self, text):
        self.text = text


class Track:
    language_code, is_generated = "ta", True

    def fetch(self):
        return [Seg("vanakkam  makkale"), Seg("inniku oru phone review")]


class Listing:
    def find_transcript(self, langs):
        return Track()


class FakeApi:
    def __init__(self, mode):
        self.mode, self.calls = mode, 0

    def list(self, vid):
        self.calls += 1
        if self.mode == "blocked":
            raise IpBlocked("blocked")
        if self.mode == "none" or vid.endswith("n"):
            raise NoTranscriptFound("none")
        return Listing()


def setup(monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_PAUSE_S", "0")
    engine = make_engine("sqlite://")
    Base.metadata.drop_all(engine)
    init_db(engine)
    s = make_session_factory(engine)()
    s.add(Channel(id="UCx", title="X", active=True))
    for i, suffix in enumerate(["a", "b", "n"]):
        s.add(Video(id=f"vid{i}{suffix}", channel_id="UCx", title="t", published_at=utcnow() - timedelta(hours=5 + i)))
    s.commit()
    return s


def test_transcripts_saved_and_no_captions_remembered(monkeypatch):
    s = setup(monkeypatch)
    out = fetch_transcripts(s, api=FakeApi("ok"))
    assert out["ok"] == 2 and out["none"] == 1
    t = s.get(VideoTranscript, "vid0a")
    assert t.status == "ok" and t.lang == "ta" and t.text == "vanakkam makkale inniku oru phone review"
    api = FakeApi("ok")
    assert fetch_transcripts(s, api=api)["ok"] == 0 and api.calls == 0  # nothing due again


def test_blocked_backs_off(monkeypatch):
    s = setup(monkeypatch)
    api = FakeApi("blocked")
    out = fetch_transcripts(s, api=api)
    assert out["blocked"] == 2 and api.calls == 2  # stops after two refusals
    again = FakeApi("ok")
    assert fetch_transcripts(s, api=again)["skipped"] and again.calls == 0  # waits a day
    assert s.scalars(select(VideoTranscript.status)).all().count("blocked") == 2
