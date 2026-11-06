import os
from datetime import timedelta

import pytest
from sqlalchemy import select

from ytanalytics.config import normalize_db_url
from ytanalytics.db import Base, Channel, Comment, Topic, Video, init_db, make_engine, make_session_factory, utcnow
from ytanalytics.local_ai import build_topics, detect_question_request, kmeans, local_emotions, topics_due

np = pytest.importorskip("numpy")


@pytest.fixture
def session():
    engine = make_engine(normalize_db_url(os.environ.get("TEST_DATABASE_URL", "sqlite://")))
    Base.metadata.drop_all(engine)
    init_db(engine)
    with make_session_factory(engine)() as s:
        yield s
    engine.dispose()


def test_questions_and_requests_in_three_languages():
    assert detect_question_request("eppo next video anna") == (True, False)
    assert detect_question_request("kya ye phone accha hai") == (True, False)
    assert detect_question_request("How much is it") == (True, False)
    assert detect_question_request("please make part 2") == (False, True)
    assert detect_question_request("iphone review podunga") == (False, True)
    assert detect_question_request("loved the editing") == (False, False)


def test_local_emotions_fill_unread_comments_only(session):
    session.add(Channel(id="UC1", title="C", active=True))
    session.add(Video(id="v1", channel_id="UC1", title="t"))
    session.commit()
    session.add_all([
        Comment(id="a", video_id="v1", channel_id="UC1", text="I am so angry about this", published_at=utcnow()),
        Comment(id="b", video_id="v1", channel_id="UC1", text="eppo part 2 podunga?", published_at=utcnow()),
        Comment(id="c", video_id="v1", channel_id="UC1", text="read by AI", emotion="love", ai_at=utcnow()),
    ])
    session.commit()

    def fake(texts):
        return [{"anger": 0.9, "joy": 0.1} if "angry" in t else {"joy": 0.4, "sadness": 0.3} for t in texts]

    assert local_emotions(session, classify=fake) == 2
    a, b, c = (session.get(Comment, i) for i in "abc")
    assert a.emotion == "anger" and b.emotion == "neutral"  # unsure (< 50%) -> neutral
    assert b.is_question and b.is_suggestion
    assert c.emotion == "love"  # online AI labels are never overwritten


def test_kmeans_separates_clear_groups():
    rng = np.random.default_rng(1)
    a = rng.normal([1, 0, 0], 0.05, (30, 3)); b = rng.normal([0, 1, 0], 0.05, (30, 3))
    x = np.vstack([a, b]); x /= np.linalg.norm(x, axis=1, keepdims=True)
    labels = kmeans(x, 2)
    assert len(set(labels[:30])) == 1 and len(set(labels[30:])) == 1 and labels[0] != labels[30]


def test_topics_grouped_named_and_trending(session):
    now = utcnow()
    session.add(Channel(id="UC1", title="C", active=True))
    session.add(Video(id="v1", channel_id="UC1", title="t"))
    session.commit()
    n = 0
    for i in range(40):  # audio complaints, mostly recent (rising)
        session.add(Comment(id=f"a{i}", video_id="v1", channel_id="UC1", text=f"the audio sound is too low here {i}",
                            sentiment="negative", sentiment_value=-0.7, like_count=i,
                            published_at=now - timedelta(days=2 if i < 30 else 20)))
    for i in range(40):  # praise for the host, mostly older
        session.add(Comment(id=f"h{i}", video_id="v1", channel_id="UC1", text=f"the host is funny and charming {i}",
                            sentiment="positive", sentiment_value=0.8, like_count=1,
                            published_at=now - timedelta(days=20 if i < 30 else 2)))
    session.commit()

    def embed(texts):
        v = np.array([[1.0, 0.02 * (k % 3), 0] if "audio" in t else [0, 0.02 * (k % 3), 1.0] for k, t in enumerate(texts)])
        return v / np.linalg.norm(v, axis=1, keepdims=True)

    class Router:
        def chat_json(self, system, user, max_tokens=0, deadline=None):
            groups = [int(line.split()[1].rstrip(":")) for line in user.splitlines() if line.startswith("Group ")]
            names = {g: ("Audio complaints" if "audio" in user.split(f"Group {g}:")[1].split("Group ")[0] else "Praise for the host")
                     for g in groups}
            return {"names": [{"g": g, "name": nm} for g, nm in names.items()]}, "fake"

    assert topics_due(session)
    assert build_topics(session, embed=embed, router=Router(), min_comments=20) == 1
    topics = {t.label: t for t in session.scalars(select(Topic))}
    assert set(topics) >= {"Audio complaints", "Praise for the host"}, set(topics)
    audio = topics["Audio complaints"]
    assert audio.negative_pct == 100 and "audio" in audio.keywords and audio.trend_pct > 0
    assert topics["Praise for the host"].trend_pct < 0 and topics["Praise for the host"].sentiment > 0.5
    assert not topics_due(session)
    assert build_topics(session, embed=embed, router=Router(), min_comments=20) == 0  # once a day
