"""E5: the Tanglish head learns from AI-labelled comments, is compared with the current model, and is used only if better."""
import json

from sqlalchemy import text

from ytanalytics.db import Base, Channel, Comment, Video, init_db, make_engine, make_session_factory, utcnow
from ytanalytics.tanglish import HeadClassifier, load_head, macro_f1, train_tanglish

WORDS = {"positive": ["semma", "vera level", "super", "mass"], "negative": ["mokka", "waste", "bore", "worst"],
         "neutral": ["enna", "eppo", "video", "part"]}


def fake_embed(texts):
    """Bag-of-cue-words vectors: enough signal for a linear head to learn."""
    import numpy as np

    vecs = []
    for t in texts:
        v = [sum(w in t for w in WORDS[m]) for m in ("positive", "negative", "neutral")] + [1.0]
        vecs.append(v)
    return np.array(vecs, dtype=float)


class Coin:
    """A 'current model' that always says neutral."""
    name = "coin"

    def __call__(self, texts):
        return [{"negative": 0.1, "neutral": 0.8, "positive": 0.1} for _ in texts]


def session_with_comments(n_each=150):
    engine = make_engine("sqlite://")
    Base.metadata.drop_all(engine)
    init_db(engine)
    s = make_session_factory(engine)()
    s.add(Channel(id="UCx", title="X", active=True))
    s.add(Video(id="v1", channel_id="UCx", title="t", published_at=utcnow()))
    i = 0
    for mood, words in WORDS.items():
        for k in range(n_each):
            s.add(Comment(id=f"c{i}", video_id="v1", channel_id="UCx", text=f"{words[k % 4]} anna {k}", sentiment=mood,
                          sentiment_source="ai", published_at=utcnow()))
            i += 1
    s.commit()
    return s


def test_macro_f1():
    assert macro_f1(["positive", "negative", "neutral"], ["positive", "negative", "neutral"]) == 1.0
    assert macro_f1(["positive", "positive"], ["negative", "negative"]) == 0.0


def test_head_trains_beats_current_and_is_used():
    s = session_with_comments()
    out = train_tanglish(s, embed=fake_embed, baseline=Coin(), extra=[("semma padam", "positive")])
    assert out["trained"] and out["in_use"] and out["macro_f1"] > out["current_macro_f1"]
    assert out["public_rows"] == 1
    head = load_head(s, embed=fake_embed)
    assert isinstance(head, HeadClassifier)
    probs = head(["vera level anna", "mokka waste"])
    assert max(probs[0], key=probs[0].get) == "positive" and max(probs[1], key=probs[1].get) == "negative"


def test_head_not_used_when_worse():
    s = session_with_comments()

    class Perfect:
        name = "perfect"

        def __call__(self, texts):
            out = []
            for t in texts:
                mood = next(m for m, ws in WORDS.items() if any(w in t for w in ws))
                out.append({m: (0.9 if m == mood else 0.05) for m in WORDS})
            return out

    def weak_embed(texts):
        import numpy as np

        return np.ones((len(texts), 2))  # no signal at all
    out = train_tanglish(s, embed=weak_embed, baseline=Perfect(), extra=[])
    assert out["trained"] and not out["in_use"]
    assert load_head(s, embed=weak_embed) is None
    assert json.loads(s.execute(text("select metrics from local_models")).scalar())["in_use"] is False


def test_too_little_data():
    s = session_with_comments(n_each=20)
    assert train_tanglish(s, embed=fake_embed, baseline=Coin(), extra=[])["trained"] is False
