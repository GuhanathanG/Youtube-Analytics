"""E7: copy-paste spam detection and data-chosen topic counts."""
import math
import random

from ytanalytics.local_ai import choose_topics, separation
from ytanalytics.spam import find_copy_paste, fingerprint


def test_fingerprint_ignores_case_spaces_and_emoji():
    assert fingerprint("Check MY channel!!! 🔥🔥 123") == fingerprint("check my channel")


def test_copy_paste_by_many_accounts_is_spam_but_common_phrases_are_not():
    paste = "Earn 5000 daily from home, message me on telegram now"
    rows = [(f"p{i}", "UC1", f"bot{i}", None, paste + (" 🔥" if i % 2 else "")) for i in range(4)]
    rows += [(f"s{i}", "UC1", f"fan{i}", None, "super anna") for i in range(10)]          # short & common: fine
    rows += [("o1", "UC1", "a", None, "loved the part where you tested the camera at night")]
    rows += [(f"x{i}", "UC2", "same", None, paste) for i in range(5)]                     # one account repeating: not a campaign
    rows += [(f"l{i}", "UC1", f"u{i}", None, "watch here https://bit.ly/abc") for i in range(3)]  # short but a link
    spam = find_copy_paste(rows, min_authors=3, min_letters=25)
    assert {f"p{i}" for i in range(4)} <= spam and {f"l{i}" for i in range(3)} <= spam
    assert not any(i.startswith(("s", "o", "x")) for i in spam)


def _blobs(k, per, dim=16, seed=1):
    import numpy as np

    rnd = np.random.default_rng(seed)
    centres = rnd.normal(size=(k, dim))
    x = np.vstack([c + rnd.normal(scale=0.15, size=(per, dim)) for c in centres])
    return x / np.linalg.norm(x, axis=1, keepdims=True)


def test_topic_count_follows_the_data():
    x = _blobs(6, 60)
    labels = choose_topics(x, len(x))
    assert 5 <= len(set(labels)) <= 7
    assert separation(x, labels) > 0.3


def test_duplicate_topics_are_merged(monkeypatch):
    import numpy as np

    x = _blobs(3, 80)
    # Two near-identical clusters made from one: should be merged back when similarity is high.
    monkeypatch.setenv("TOPIC_MERGE_SIMILARITY", "0.9")
    labels = choose_topics(np.vstack([x, x[:80] + 0.001]), 320)
    assert len(set(labels)) <= 4
