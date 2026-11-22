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
