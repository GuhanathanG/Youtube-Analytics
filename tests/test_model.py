"""Prediction engine: features, the no-peeking baseline, and that it finds an effect planted in the data."""
import math
import random
from datetime import datetime, timedelta

from ytanalytics import model as M


def test_duration_and_title_features():
    assert M.duration_seconds("PT1H2M3S") == 3723
    assert M.duration_seconds("PT46S") == 46
    assert M.duration_seconds(None) is None
    f = M.title_features("Top 10 BEST phones?! 🔥 (2026) | Review")
    assert f["has_number"] == f["has_question"] == f["has_exclaim"] == f["has_emoji"] == f["has_brackets"] == 1
    assert f["has_caps_word"] == f["has_pipe"] == f["has_year"] == 1
    assert M.title_features("a calm vlog")["has_number"] == 0


def test_curve_is_monotonic_and_ends_at_one():
    shares = [M.curve_share(M.DEFAULT_CURVE, h) for h in (0.5, 1, 3, 24, 100, 720, 2000)]
    assert shares == sorted(shares) and shares[-1] == 1.0


def _videos(n=400, seed=3):
    rnd = random.Random(seed)
    start = datetime(2023, 1, 1, 12)
    rows = []
    for i in range(n):
        has_num = rnd.random() < 0.5
        views = 10000 * (2.0 if has_num else 1.0) * math.exp(rnd.gauss(0, 0.25))
        rows.append({"id": f"v{i}", "channel_id": "c1", "title": ("Top 5 " if has_num else "My ") + "day",
                     "description": "", "duration": "PT12M", "tags": "a|b", "has_captions": False, "live_status": None,
                     "published_at": start + timedelta(days=2 * i, hours=rnd.choice([0, 3, 6])),
                     "view_count": int(views), "like_count": int(views * 0.04), "comment_count": 10})
    return rows, start + timedelta(days=2 * n + 10)


def test_baseline_uses_only_earlier_videos():
    rows, now = _videos(30)
    ex = M.build_examples(rows, now)
    first = ex[0]
    earlier = sorted(r["view_count"] for r in rows if r["published_at"] < first.published_at)
    assert first.baseline == earlier[len(earlier) // 2]


def test_engine_learns_planted_effect_and_beats_guessing():
    rows, now = _videos()
    ex = M.build_examples(rows, now)
    train = [e for e in ex if e.age_days >= M.MATURE_DAYS]
    bt = M.backtest(train)
    assert bt["tested"] > 50
    assert bt["within_2x"] >= bt["baseline_within_2x"] and bt["typical_miss"] < bt["baseline_typical_miss"]
    drv = {d["key"]: d for d in M.stable_drivers(train, train)}
    assert "has_number" in drv and 0.5 < drv["has_number"]["effect"] < 1.6  # planted: 2× views (+100%)


def test_forecast_trusts_real_numbers_as_video_ages():
    rows, now = _videos()
    ex = M.build_examples(rows, now)
    train = [e for e in ex if e.age_days >= M.MATURE_DAYS]
    import numpy as np
    m = M._fit(M.matrix(train), np.array([e.target for e in train]))
    young = ex[-1]
    young.age_days, young.views = 3.0, 60000  # far above normal after 3 days
    f = M.forecast(m, young, M.DEFAULT_CURVE)
    assert f["confidence"] == 0.9 and f["views_30d"] > 60000 and f["low"] < f["views_30d"] < f["high"]
    young.age_days, young.views = 0.1, 100
    assert M.forecast(m, young, M.DEFAULT_CURVE)["confidence"] < 0.1


def test_linear_export_shape():
    rows, now = _videos(120)
    train = [e for e in M.build_examples(rows, now) if e.age_days >= M.MATURE_DAYS]
    lin = M.fit_linear(train)
    assert len(lin["coef"]) == len(lin["features"]) == len(lin["mean"]) == len(lin["scale"])
    assert lin["coef"][lin["features"].index("has_number")] > 0
