from datetime import datetime

from sqlalchemy import select

from ytanalytics.config import Settings
from ytanalytics.db import Channel, Comment, Video, init_db, make_engine, make_session_factory
from ytanalytics.sentiment import analyze_pending, detect_language, summarize_probs


def test_detect_language_scripts():
    assert detect_language("மிகவும் அருமையான பதிவு") == "ta"
    assert detect_language("बहुत बेकार वीडियो है") == "hi"
    assert detect_language("ఈ వీడియో చాలా బాగుంది") == "te"
    assert detect_language("ഈ വീഡിയോ വളരെ നല്ലതാണ്") == "ml"
    assert detect_language("This video is really great, thanks for making it") == "en"
    assert detect_language("🔥🔥🔥") == "und"
    assert detect_language("") == "und"


def test_summarize_probs():
    label, conf, value = summarize_probs({"negative": 0.1, "neutral": 0.2, "positive": 0.7})
    assert label == "positive" and conf == 0.7 and abs(value - 0.6) < 1e-9


class FakeClassifier:
    name = "fake"

    def __call__(self, texts):
        out = []
        for t in texts:
            if "bad" in t:
                out.append({"negative": 0.9, "neutral": 0.05, "positive": 0.05})
            else:
                out.append({"negative": 0.05, "neutral": 0.15, "positive": 0.8})
        return out


def test_analyze_pending_labels_everything_once():
    settings = Settings.from_env()
    settings.analyze_batch_size = 3
    engine = make_engine("sqlite://")
    init_db(engine)
    with make_session_factory(engine)() as s:
        s.add(Channel(id="UC1", title="c"))
        s.add(Video(id="v1", channel_id="UC1", title="v"))
        for i in range(10):
            s.add(Comment(id=f"c{i}", video_id="v1", channel_id="UC1",
                          text="bad video" if i % 2 else "great video", published_at=datetime(2026, 1, i + 1)))
        s.commit()

        assert analyze_pending(s, settings, classifier=FakeClassifier()) == 10
        rows = s.scalars(select(Comment)).all()
        assert all(r.analyzed_at for r in rows)
        assert {r.sentiment for r in rows if "bad" in r.text} == {"negative"}
        assert {r.sentiment for r in rows if "great" in r.text} == {"positive"}
        assert all(r.language == "en" for r in rows)
        # nothing left to do
        assert analyze_pending(s, settings, classifier=FakeClassifier()) == 0


def test_detect_romanized_indian_languages():
    assert detect_language("semma video bro") == "ta-Latn"
    assert detect_language("thalaivar mass da") == "ta-Latn"
    assert detect_language("bhai bahut accha video hai") == "hi-Latn"
    assert detect_language("bad video") == "en"
    assert detect_language("Ceci est une très bonne vidéo, merci beaucoup") == "fr"
