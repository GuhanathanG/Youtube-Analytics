"""E9: lasting shifts and one-day spikes."""
import random
from datetime import date, timedelta

from ytanalytics.changes import describe, find_shift, find_spike


def noisy(level, n, seed):
    rnd = random.Random(seed)
    return [level * (1 + rnd.uniform(-0.08, 0.08)) for _ in range(n)]


def test_shift_found_where_the_level_steps_up():
    values = noisy(1000, 40, 1) + noisy(2000, 12, 2)
    i, before, after = find_shift(values)
    assert 38 <= i <= 42 and 900 < before < 1100 and 1800 < after < 2200


def test_no_shift_in_steady_noise():
    assert find_shift(noisy(1000, 60, 3)) is None


def test_spike_vs_ordinary_day():
    assert find_spike(noisy(1000, 30, 4) + [5200]) is not None
    assert find_spike(noisy(1000, 30, 5) + [1080]) is None


def test_description_reads_naturally():
    e = {"day": date(2026, 11, 10), "metric": "views", "kind": "shift", "before": 1000, "after": 2100, "pct": 110}
    assert describe(e) == "daily views stepped up 110% from 10 Nov (1,000 → 2,100 a day)."
    m = {"day": date(2026, 11, 10), "metric": "mood", "kind": "shift", "before": 40, "after": 10, "pct": -30}
    assert "darker" in describe(m)
