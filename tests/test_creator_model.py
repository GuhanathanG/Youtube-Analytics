"""Creator Model v1: thumbnail and early-hours features, and the safe feature-set choice."""
import json
import math

from ytanalytics.model import EARLY_FEATURES, THUMB_FEATURES, early_features, pick_feature_set, thumb_features


def test_thumb_features_from_analysis():
    f = thumb_features(json.dumps({"faces": 2, "face_emotion": "Excited", "text_words": 7, "text_language": "English",
                                   "brightness": "bright", "contrast": "high", "clickbait": 3, "elements": ["emoji", "red arrow"]}))
    assert f["thumb_face"] == 1 and f["thumb_faces"] == 2 and f["thumb_happy_face"] == 1
    assert f["thumb_text"] == 1 and f["thumb_text_words"] == 7 and f["thumb_english_text"] == 1
    assert f["thumb_bright"] == 1 and f["thumb_dark"] == 0 and f["thumb_high_contrast"] == 1
    assert f["thumb_clickbait"] == 3 and f["thumb_emoji"] == 1 and f["thumb_arrow"] == 1
    missing = thumb_features(None)
    assert set(missing) == set(THUMB_FEATURES) and all(math.isnan(v) for v in missing.values())
    assert math.isnan(thumb_features("not json")["thumb_face"])


def test_early_features_relative_to_normal():
    f = early_features([(5.0, 900.0), (25.0, 4000.0), (200.0, 9000.0)], baseline=1000.0)
    assert set(f) == set(EARLY_FEATURES)
    assert math.isclose(f["early_6h"], math.log1p(900) - math.log1p(1000))
    assert math.isclose(f["early_24h"], math.log1p(4000) - math.log1p(1000))
    assert math.isnan(f["early_48h"])  # no snapshot near 48 h


def test_richer_features_win_only_when_clearly_better():
    base = {"tested": 100, "rank_corr": 0.20, "within_2x": 0.46}
    assert pick_feature_set({"base": base, "creator_v1": {"tested": 100, "rank_corr": 0.30, "within_2x": 0.50}}) == "creator_v1"
    assert pick_feature_set({"base": base, "creator_v1": {"tested": 100, "rank_corr": 0.30, "within_2x": 0.40}}) == "base"
    assert pick_feature_set({"base": base, "creator_v1": {"tested": 100, "rank_corr": 0.205, "within_2x": 0.50}}) == "base"
    assert pick_feature_set({"base": base, "creator_v1": {"tested": 0}}) == "base"


def test_fit_survives_a_signal_missing_everywhere():
    import numpy as np

    from ytanalytics.model import _fit

    rng = np.random.default_rng(1)
    X = rng.normal(size=(80, 3))
    X[:, 2] = np.nan
    m = _fit(X, X[:, 0] * 2)
    assert np.isfinite(m.predict(X)).all()


def test_first_day_comment_features():
    from datetime import timedelta

    from ytanalytics.db import Channel, Comment, Video, init_db, make_engine, make_session_factory, utcnow
    from ytanalytics.model import COMMENT_FEATURES, PLUS_FEATURES, first_day_comments

    assert set(COMMENT_FEATURES) <= set(PLUS_FEATURES)
    eng = make_engine("sqlite://")
    init_db(eng)
    now = utcnow().replace(microsecond=0)
    with make_session_factory(eng)() as s:
        s.add(Channel(id="UC1", title="c", active=True))
        s.commit()
        s.add(Video(id="v1", channel_id="UC1", title="a", published_at=now - timedelta(days=3)))
        s.add(Video(id="v2", channel_id="UC1", title="b", published_at=now - timedelta(hours=5)))  # day not finished
        s.commit()
        for i, (h, val, q) in enumerate([(1, 1.0, False), (10, 0.0, True), (40, -1.0, False)]):
            s.add(Comment(id=f"c{i}", video_id="v1", channel_id="UC1", text="x", published_at=now - timedelta(days=3) + timedelta(hours=h),
                          sentiment_value=val, is_question=q))
        s.add(Comment(id="c9", video_id="v2", channel_id="UC1", text="x", published_at=now - timedelta(hours=4), sentiment_value=1.0))
        s.commit()
        f = first_day_comments(s)
    assert set(f) == {"v1"}
    assert abs(f["v1"]["c24_mood"] - 0.5) < 1e-9 and abs(f["v1"]["c24_questions"] - 0.5) < 1e-9  # the 40 h comment is outside
