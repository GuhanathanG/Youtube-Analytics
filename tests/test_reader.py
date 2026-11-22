"""Pulse Reader: label encoding/decoding, held-out split and trust thresholds (no torch needed)."""
from ytanalytics.ai import ASPECTS, EMOTIONS
from ytanalytics.reader import FLAGS, MOODS, decode, encode, evaluate, in_holdout, macro_f1, threshold_for


def test_encode_maps_ai_labels():
    t = encode({"sentiment": "negative", "emotion": "sarcasm", "is_question": True, "is_spam": None,
                "aspects": "host:pos,audio:neg,bogus:pos,content:weird"})
    assert t["mood"] == 0 and t["emotion"] == EMOTIONS.index("sarcasm")
    assert t["flags"] == [1, 0, 0, 0]
    assert t["aspects"][ASPECTS.index("host")] == 1 and t["aspects"][ASPECTS.index("audio")] == 2
    assert t["aspects"][ASPECTS.index("content")] == 0 and sum(t["aspects"]) == 3
    assert encode({"sentiment": "meh", "emotion": None})["mood"] == -1


def test_decode_gives_ai_shaped_row_with_confidence():
    aspects = [[5, 0, 0, 0] for _ in ASPECTS]
    aspects[ASPECTS.index("editing")] = [0, 0, 6, 0]
    emo = [0.0] * len(EMOTIONS)
    emo[EMOTIONS.index("anger")] = 4
    p = decode([3, 0, -2], emo, [4, -4, -6, 2], aspects)
    assert p["sentiment"] == "negative" and p["score"] < 0
    assert p["emotion"] == "anger"
    assert p["is_question"] and not p["is_suggestion"] and not p["is_spam"] and p["is_toxic"]
    assert p["aspects"] == "editing:neg"
    assert 0.9 < p["conf"]["mood"] < 1 and set(p["conf"]) == {"mood", "emotion", "aspects", *FLAGS}


def test_holdout_is_stable_and_about_5_percent():
    ids = [f"c{i}" for i in range(20000)]
    share = sum(map(in_holdout, ids)) / len(ids)
    assert 0.04 < share < 0.06
    assert [in_holdout(i) for i in ids[:50]] == [in_holdout(i) for i in ids[:50]]


def test_threshold_finds_confident_slice():
    # High-confidence answers are right, low-confidence ones are a coin flip.
    conf = [0.99 - i * 0.001 for i in range(400)] + [0.5] * 400
    ok = [True] * 400 + [i % 2 == 0 for i in range(400)]
    r = threshold_for(conf, ok, target=0.9)
    assert r["threshold"] is not None and r["threshold"] >= 0.5
    assert 0.5 <= r["coverage"] <= 1 and r["agreement"] >= 0.9
    assert threshold_for([0.6] * 100, [False] * 100)["threshold"] is None


def test_macro_f1_and_evaluate_shapes():
    assert macro_f1([0, 1, 2], [0, 1, 2], 3) == 1.0
    rows = [{"sentiment": MOODS[i % 3], "emotion": "joy", "is_question": i % 2 == 0, "aspects": None} for i in range(60)]
    preds = [decode([1 if i % 3 == 0 else 0, 1 if i % 3 == 1 else 0, 1 if i % 3 == 2 else 0],
                    [1 if e == "joy" else 0 for e in EMOTIONS], [2 if i % 2 == 0 else -2, -3, -3, -3],
                    [[3, 0, 0, 0] for _ in ASPECTS]) for i in range(60)]
    res = evaluate(preds, rows)
    assert res["mood"]["accuracy"] == 1.0 and res["emotion"]["accuracy"] == 1.0
    assert res["question"]["f1"] == 1.0 and res["aspects"]["exact_match"] == 1.0


def test_new_model_only_replaces_when_not_worse():
    from ytanalytics.reader import should_replace

    new = {"trained": True, "tasks": {"mood": {"macro_f1": 0.80}}}
    assert should_replace(new, None)[0]
    assert should_replace(new, {"tasks": {"mood": {"macro_f1": 0.805}}})[0]
    assert not should_replace(new, {"tasks": {"mood": {"macro_f1": 0.85}}})[0]
    assert not should_replace({"trained": False, "reason": "x"}, None)[0]
