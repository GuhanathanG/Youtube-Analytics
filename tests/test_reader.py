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


def test_archive_reader_rows_split_full_and_partial():
    from datetime import datetime

    from ytanalytics.archive_ai import reader_rows

    def pred(mood_conf):
        return {"sentiment": "positive", "score": 0.8, "emotion": "joy", "is_question": False, "is_suggestion": False,
                "is_spam": False, "is_toxic": False, "aspects": "host:pos",
                "conf": {"mood": mood_conf, "emotion": 0.9, "question": 0.99, "suggestion": 0.99, "spam": 0.99,
                         "toxic": 0.99, "aspects": 0.5}}

    th = {"mood": 0.8, "emotion": 0.6, "question": 0.9, "suggestion": 0.9, "spam": 0.9, "toxic": 0.9, "aspects": 0.9}

    def trusted(p):
        out = {}
        for task, field in [("mood", "sentiment"), ("emotion", "emotion"), ("aspects", "aspects"), ("question", "is_question"),
                            ("suggestion", "is_suggestion"), ("spam", "is_spam"), ("toxic", "is_toxic")]:
            if p["conf"][task] >= th[task]:
                out[field] = p[field]
                if task == "mood":
                    out["score"] = p["score"]
        return out

    now = datetime(2026, 11, 22)
    rows, full = reader_rows(["a", "b"], [pred(0.95), pred(0.5)], trusted, now)
    assert full == 1
    a, b = rows
    assert a["ai_model"] == "local/pulse-reader" and a["ai_at"] == now and a["sentiment"] == "positive"
    assert "aspects" not in a and "score" not in a and a["sentiment_source"] == "reader"
    assert b == {"id": "b", "analyzer": "pulse-reader"}  # untrusted mood: only marked as seen


def test_per_task_bar_picked_from_curve():
    from ytanalytics.reader import pick_threshold, task_targets

    task = {"threshold": None, "curve": {"0.95": {"threshold": None}, "0.9": {"threshold": None},
                                         "0.85": {"threshold": 0.7}, "0.8": {"threshold": 0.5}}}
    assert pick_threshold(task, 0.8) == 0.5 and pick_threshold(task, 0.85) == 0.7 and pick_threshold(task, 0.9) is None
    assert pick_threshold({"threshold": 0.6}, 0.8) == 0.6  # older metrics without a curve
    assert task_targets({"READER_TARGETS": "emotion=0.75"}) == {"emotion": 0.75}


def test_rare_flags_must_beat_always_no():
    from ytanalytics.reader import FLAGS, decode, evaluate

    # 2% spam; the model calls 5% of comments spam: 95% agreement, worse than always "no" (98%).
    rows = [{"sentiment": "neutral", "emotion": "joy", "is_spam": i < 4, "aspects": None} for i in range(200)]
    preds = []
    for i in range(200):
        spam_logit = 3.0 if i < 10 else -0.2  # flags 10 (4 right, 6 wrong); the rest barely "no"
        preds.append(decode([0, 2, 0], [1 if e == "joy" else 0 for e in EMOTIONS], [-3, -3, spam_logit, -3], [[3, 0, 0, 0] for _ in ASPECTS]))
    res = evaluate(preds, rows)
    assert res["spam"]["floor"] >= 0.98
    assert res["spam"]["threshold"] is None or res["spam"]["agreement"] >= res["spam"]["floor"]
    assert set(FLAGS) <= set(res)
