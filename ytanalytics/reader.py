"""Pulse Reader: our own comment-reading model (research doc, Level 1).

One small multilingual model reads a comment and predicts, in a single pass, everything the cloud AI gives us
per comment except the translation:
  mood (negative / neutral / positive), emotion (16), question / suggestion / spam / toxic, and for each of the
  13 aspects whether it is talked about and how (none / pos / neg / neu).

How it learns: it is fine-tuned on comments the cloud AI (Gemini etc.) already read, from the main database and
every archive database, so it learns this audience's way of writing (Tanglish included). Only the comment text is
used: no names, ids or channels.

How it is trusted: a fixed 5% of comments (chosen by a hash of the id) is never trained on. On that held-out set
we measure agreement with the cloud AI, and for every task we find the confidence above which the model agrees at
least TARGET (90%) of the time and how many comments clear it ("coverage"). The pipeline only uses an answer
when it is at least that confident, so low-confidence comments still go to the cloud AI.

Where it lives: exported to ONNX, shrunk to 8-bit and published as a GitHub release asset; the `local_models`
row "pulse-reader" holds where to download it plus the label lists, thresholds and metrics. Runs on CPU.

Heavy imports (torch, transformers, onnxruntime) are inside functions so the rest of the worker never needs them.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import random
import tarfile
import time
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from .ai import ASPECTS, EMOTIONS

log = logging.getLogger(__name__)

NAME = "pulse-reader"
BASE_MODEL = os.environ.get("READER_BASE", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
MOODS = ["negative", "neutral", "positive"]
FLAGS = ["question", "suggestion", "spam", "toxic"]
ASPECT_STATES = ["none", "pos", "neg", "neu"]
TARGET = float(os.environ.get("READER_TARGET_AGREEMENT", "0.9"))
MAX_LEN = int(os.environ.get("READER_MAX_LEN", "96"))
HOLDOUT_EVERY = 20  # 1 in 20 comments (5%) is held out, by a hash of its id


# ----------------------------------------------------------------------------------------------- labels
def in_holdout(comment_id: str) -> bool:
    return int(hashlib.md5(comment_id.encode()).hexdigest()[:8], 16) % HOLDOUT_EVERY == 0


def encode(row: dict) -> dict:
    """Training targets for one AI-labelled comment. -1 = unknown (not counted in that task's loss)."""
    mood = row.get("sentiment")
    emo = row.get("emotion")
    aspects = [0] * len(ASPECTS)  # 0 = none
    for part in (row.get("aspects") or "").split(","):
        name, _, pol = part.strip().partition(":")
        if name in ASPECTS and pol in ASPECT_STATES[1:]:
            aspects[ASPECTS.index(name)] = ASPECT_STATES.index(pol)
    return {
        "mood": MOODS.index(mood) if mood in MOODS else -1,
        "emotion": EMOTIONS.index(emo) if emo in EMOTIONS else -1,
        "flags": [int(bool(row.get(f"is_{f}"))) for f in FLAGS],
        "aspects": aspects,
    }


def _softmax(xs: list[float]) -> list[float]:
    m = max(xs)
    e = [math.exp(x - m) for x in xs]
    s = sum(e)
    return [v / s for v in e]


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x)) if x > -60 else 0.0


def decode(mood_logits, emotion_logits, flag_logits, aspect_logits) -> dict:
    """One comment's raw outputs -> labels in the same shape the cloud AI writes, plus a confidence per task."""
    mp = _softmax(list(mood_logits))
    ep = _softmax(list(emotion_logits))
    fp = [_sigmoid(x) for x in flag_logits]
    aspects, a_conf = [], 1.0
    for i, logits in enumerate(aspect_logits):
        p = _softmax(list(logits))
        k = max(range(len(p)), key=p.__getitem__)
        a_conf = min(a_conf, p[k])
        if k:
            aspects.append(f"{ASPECTS[i]}:{ASPECT_STATES[k]}")
    mood_i = max(range(3), key=mp.__getitem__)
    emo_i = max(range(len(ep)), key=ep.__getitem__)
    return {
        "sentiment": MOODS[mood_i],
        "score": round(mp[2] - mp[0], 4),
        "emotion": EMOTIONS[emo_i],
        **{f"is_{f}": fp[i] >= 0.5 for i, f in enumerate(FLAGS)},
        "aspects": ",".join(aspects) or None,
        "conf": {
            "mood": mp[mood_i], "emotion": ep[emo_i],
            **{f: max(fp[i], 1 - fp[i]) for i, f in enumerate(FLAGS)},
            "aspects": a_conf,
        },
    }


def threshold_for(conf: list[float], correct: list[bool], target: float = TARGET, min_n: int = 50) -> dict:
    """Lowest confidence cut-off at which answers at or above it agree with the cloud AI >= target.

    Returns {"threshold", "coverage", "agreement"}; threshold None when no cut-off reaches the target."""
    pairs = sorted(zip(conf, correct), key=lambda p: -p[0])
    best, hits = None, 0
    for n, (c, ok) in enumerate(pairs, 1):
        hits += ok
        if n >= min_n and hits / n >= target:
            best = (c, n, hits / n)
    if best is None:
        return {"threshold": None, "coverage": 0.0, "agreement": round(hits / len(pairs), 4) if pairs else None}
    return {"threshold": round(best[0], 4), "coverage": round(best[1] / len(pairs), 4), "agreement": round(best[2], 4)}


def macro_f1(truth: list[int], pred: list[int], n_classes: int) -> float:
    f1s = []
    for c in range(n_classes):
        tp = sum(t == c and p == c for t, p in zip(truth, pred))
        fp = sum(t != c and p == c for t, p in zip(truth, pred))
        fn = sum(t == c and p != c for t, p in zip(truth, pred))
        if tp + fp + fn == 0:
            continue
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1s.append(2 * prec * rec / (prec + rec) if prec + rec else 0.0)
    return round(sum(f1s) / len(f1s), 4) if f1s else 0.0


# ----------------------------------------------------------------------------------------------- data
_COLS = "id, text, sentiment, emotion, is_question, is_suggestion, is_spam, is_toxic, aspects"
_WHERE = ("ai_at is not null and coalesce(ai_model, '') not like 'rules%' and coalesce(ai_model, '') not like 'local%' "
          "and sentiment is not null and length(text) between 2 and 600")


def _rows_from(conn, limit: int) -> list[dict]:
    # md5 order = a fixed pseudo-random sample, the same on every run (so the held-out set never leaks).
    rows = conn.execute(text(f"select {_COLS} from comments where {_WHERE} order by md5(id) limit :n"), {"n": limit})
    return [dict(r._mapping) for r in rows]


def load_rows(session: Session, limit: int) -> list[dict]:
    """AI-labelled comments from the main database and every archive database (text and labels only)."""
    from sqlalchemy import create_engine

    from .archive import archive_urls
    from .config import normalize_db_url

    out = _rows_from(session, limit)
    for url in archive_urls(session):
        try:
            eng = create_engine(normalize_db_url(url), pool_pre_ping=True)
            with eng.connect() as conn:
                out += _rows_from(conn, limit)
            eng.dispose()
        except Exception as e:  # an unreachable archive should not stop training
            log.warning("Archive skipped for training: %s", str(e).splitlines()[0][:200])
    seen, uniq = set(), []
    for r in out:
        if r["id"] not in seen:
            seen.add(r["id"])
            uniq.append(r)
    return uniq


# ----------------------------------------------------------------------------------------------- model
def _build_model(base: str):
    import torch
    from torch import nn
    from transformers import AutoModel

    class Reader(nn.Module):
        def __init__(self):
            super().__init__()
            self.enc = AutoModel.from_pretrained(base)
            h = self.enc.config.hidden_size
            self.drop = nn.Dropout(0.1)
            self.mood = nn.Linear(h, len(MOODS))
            self.emotion = nn.Linear(h, len(EMOTIONS))
            self.flags = nn.Linear(h, len(FLAGS))
            self.aspects = nn.Linear(h, len(ASPECTS) * len(ASPECT_STATES))

        def forward(self, input_ids, attention_mask):
            out = self.enc(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
            m = attention_mask.unsqueeze(-1).to(out.dtype)
            pooled = self.drop((out * m).sum(1) / m.sum(1).clamp(min=1.0))
            a = self.aspects(pooled).view(-1, len(ASPECTS), len(ASPECT_STATES))
            return self.mood(pooled), self.emotion(pooled), self.flags(pooled), a

    torch.manual_seed(7)
    return Reader()


@dataclass
class TrainResult:
    metrics: dict
    out_dir: Path | None


def _batches(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _predict(model, tok, texts: list[str], batch: int = 64):
    import torch

    model.eval()
    outs = []
    with torch.no_grad():
        for chunk in _batches(texts, batch):
            enc = tok(chunk, padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt")
            m, e, f, a = model(enc["input_ids"], enc["attention_mask"])
            for i in range(len(chunk)):
                outs.append(decode(m[i].tolist(), e[i].tolist(), f[i].tolist(), a[i].tolist()))
    return outs


def evaluate(preds: list[dict], rows: list[dict]) -> dict:
    """Agreement with the cloud AI per task, plus the confidence cut-off and coverage at TARGET agreement."""
    res = {}
    t_mood = [MOODS.index(r["sentiment"]) for r in rows]
    p_mood = [MOODS.index(p["sentiment"]) for p in preds]
    res["mood"] = {"accuracy": round(sum(a == b for a, b in zip(t_mood, p_mood)) / len(rows), 4),
                   "macro_f1": macro_f1(t_mood, p_mood, 3),
                   **threshold_for([p["conf"]["mood"] for p in preds], [a == b for a, b in zip(t_mood, p_mood)])}
    idx = [i for i, r in enumerate(rows) if r.get("emotion") in EMOTIONS]
    if idx:
        ok = [preds[i]["emotion"] == rows[i]["emotion"] for i in idx]
        res["emotion"] = {"accuracy": round(sum(ok) / len(idx), 4),
                          **threshold_for([preds[i]["conf"]["emotion"] for i in idx], ok)}
    for f in FLAGS:
        truth = [bool(r.get(f"is_{f}")) for r in rows]
        pred = [p[f"is_{f}"] for p in preds]
        tp = sum(a and b for a, b in zip(truth, pred))
        prec = tp / max(1, sum(pred))
        rec = tp / max(1, sum(truth))
        ok = [a == b for a, b in zip(truth, pred)]
        res[f] = {"f1": round(2 * prec * rec / (prec + rec), 4) if prec + rec else 0.0, "positives": sum(truth),
                  **threshold_for([p["conf"][f] for p in preds], ok)}
    ok = [(p["aspects"] or "") == ",".join(f"{a}:{s}" for a, s in
          (x.split(":") for x in (r.get("aspects") or "").split(",") if ":" in x) if a in ASPECTS) for p, r in zip(preds, rows)]
    res["aspects"] = {"exact_match": round(sum(ok) / len(rows), 4), **threshold_for([p["conf"]["aspects"] for p in preds], ok)}
    return res


def train(session: Session, out_dir: str | Path = "reader-out") -> TrainResult:
    """Fine-tune, evaluate on the held-out 5%, export ONNX (8-bit). Time-boxed by READER_MAX_MINUTES."""
    import torch
    from torch import nn
    from transformers import AutoTokenizer, get_linear_schedule_with_warmup

    from .sentiment import _clean

    t0 = time.time()
    per_db = int(os.environ.get("READER_ROWS_PER_DB", "150000"))
    rows = load_rows(session, per_db)
    for r in rows:
        r["text"] = _clean(r["text"])
    test = [r for r in rows if in_holdout(r["id"])][: int(os.environ.get("READER_TEST_ROWS", "6000"))]
    train_rows = [r for r in rows if not in_holdout(r["id"])]
    if len(train_rows) < 2000 or len(test) < int(os.environ.get("READER_MIN_TEST", "300")):
        return TrainResult({"trained": False, "reason": f"not enough AI-labelled comments ({len(train_rows)} train, {len(test)} test)"}, None)
    random.Random(7).shuffle(train_rows)
    max_train = int(os.environ.get("READER_MAX_TRAIN", "120000"))
    train_rows = train_rows[:max_train]
    log.info("Pulse Reader: %d training and %d held-out comments (loaded in %.0fs)", len(train_rows), len(test), time.time() - t0)

    torch.set_num_threads(max(1, os.cpu_count() or 1))
    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    model = _build_model(BASE_MODEL)
    enc_targets = [encode(r) for r in train_rows]
    # Class weights: rarer moods and flags count more, so "spam" and "negative" aren't drowned out.
    mood_counts = [sum(t["mood"] == i for t in enc_targets) or 1 for i in range(3)]
    mood_w = torch.tensor([len(enc_targets) / (3 * c) for c in mood_counts], dtype=torch.float)
    flag_pos = [sum(t["flags"][i] for t in enc_targets) or 1 for i in range(len(FLAGS))]
    flag_w = torch.tensor([min(20.0, (len(enc_targets) - p) / p) for p in flag_pos], dtype=torch.float)
    aspect_w = torch.tensor([0.3, 1.0, 1.5, 1.0])  # "none" is by far the most common state

    ce_mood = nn.CrossEntropyLoss(weight=mood_w, ignore_index=-1)
    ce_emo = nn.CrossEntropyLoss(ignore_index=-1)
    bce = nn.BCEWithLogitsLoss(pos_weight=flag_w)
    ce_asp = nn.CrossEntropyLoss(weight=aspect_w)

    bs = int(os.environ.get("READER_BATCH", "32"))
    epochs = float(os.environ.get("READER_EPOCHS", "1"))
    steps = max(1, int(len(train_rows) / bs * epochs))
    opt = torch.optim.AdamW(model.parameters(), lr=float(os.environ.get("READER_LR", "4e-5")), weight_decay=0.01)
    sched = get_linear_schedule_with_warmup(opt, int(steps * 0.06), steps)
    budget = float(os.environ.get("READER_MAX_MINUTES", "150")) * 60
    model.train()
    step = 0
    order = list(range(len(train_rows)))
    while step < steps and time.time() - t0 < budget:
        random.Random(step).shuffle(order)
        for chunk in _batches(order, bs):
            if step >= steps or time.time() - t0 > budget:
                break
            enc = tok([train_rows[i]["text"] for i in chunk], padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt")
            tg = [enc_targets[i] for i in chunk]
            m, e, f, a = model(enc["input_ids"], enc["attention_mask"])
            loss = (ce_mood(m, torch.tensor([t["mood"] for t in tg]))
                    + 0.7 * ce_emo(e, torch.tensor([t["emotion"] for t in tg]))
                    + 0.5 * bce(f, torch.tensor([t["flags"] for t in tg], dtype=torch.float))
                    + 0.5 * ce_asp(a.reshape(-1, len(ASPECT_STATES)), torch.tensor([t["aspects"] for t in tg]).reshape(-1)))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad()
            step += 1
            if step % 200 == 0:
                log.info("step %d/%d loss %.3f (%.0f min)", step, steps, loss.item(), (time.time() - t0) / 60)

    preds = _predict(model, tok, [r["text"] for r in test])
    metrics = {"trained": True, "base_model": BASE_MODEL, "train_rows": len(train_rows), "test_rows": len(test),
               "steps": step, "planned_steps": steps, "minutes": round((time.time() - t0) / 60, 1),
               "target_agreement": TARGET, "tasks": evaluate(preds, test)}
    out = Path(out_dir)
    export(model, tok, out)
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return TrainResult(metrics, out)


def export(model, tok, out: Path) -> Path:
    """ONNX export + 8-bit dynamic quantisation + tokenizer files, packed into one archive."""
    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic

    out.mkdir(parents=True, exist_ok=True)
    model.eval()
    sample = tok(["semma video bro", "hello"], padding=True, return_tensors="pt")
    fp32 = out / "reader-fp32.onnx"
    torch.onnx.export(model, (sample["input_ids"], sample["attention_mask"]), str(fp32),
                      input_names=["input_ids", "attention_mask"], output_names=["mood", "emotion", "flags", "aspects"],
                      dynamic_axes={"input_ids": {0: "b", 1: "t"}, "attention_mask": {0: "b", 1: "t"},
                                    "mood": {0: "b"}, "emotion": {0: "b"}, "flags": {0: "b"}, "aspects": {0: "b"}},
                      opset_version=17, dynamo=False)
    pack = out / "pack"
    pack.mkdir(exist_ok=True)
    root = logging.getLogger()
    level = root.level
    root.setLevel(logging.WARNING)  # the quantiser logs a line per tensor
    try:
        quantize_dynamic(str(fp32), str(pack / "reader.onnx"), weight_type=QuantType.QInt8)
    finally:
        root.setLevel(level)
    fp32.unlink()
    tok.save_pretrained(str(pack))
    tar = out / "pulse-reader.tar.gz"
    with tarfile.open(tar, "w:gz") as t:
        for p in pack.iterdir():
            t.add(p, arcname=p.name)
    return tar


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def should_replace(new: dict, old: dict | None, slack: float = 0.01) -> tuple[bool, str]:
    """A newly trained model takes over only if its mood agreement isn't worse than the one in use."""
    if not new.get("trained"):
        return False, new.get("reason", "not trained")
    new_f1 = new["tasks"]["mood"]["macro_f1"]
    old_f1 = ((old or {}).get("tasks") or {}).get("mood", {}).get("macro_f1")
    if old_f1 is not None and new_f1 < old_f1 - slack:
        return False, f"mood macro-F1 {new_f1} is below the current model's {old_f1}"
    return True, f"mood macro-F1 {new_f1} (current {old_f1})"


def save_record(session: Session, metrics: dict, url: str, digest: str) -> None:
    """Remember where the model is and how far to trust each task (the analyse step reads this)."""
    from .tanglish import ensure_table

    ensure_table(session)
    tasks = metrics.get("tasks", {})
    payload = {"url": url, "sha256": digest, "max_len": MAX_LEN, "moods": MOODS, "emotions": EMOTIONS, "flags": FLAGS,
               "aspects": ASPECTS, "aspect_states": ASPECT_STATES,
               "thresholds": {k: v.get("threshold") for k, v in tasks.items()}}
    session.execute(text("delete from local_models where name = :n"), {"n": NAME})
    session.execute(text("insert into local_models (name, trained_at, metrics, payload) values (:n, now() at time zone 'utc', :m, :p)"),
                    {"n": NAME, "m": json.dumps(metrics), "p": json.dumps(payload)})
    session.commit()


# ----------------------------------------------------------------------------------------------- inference
class PulseReader:
    """Loads the published model (downloaded once, checked by hash) and labels comments on CPU."""

    def __init__(self, payload: dict, cache_dir: str | Path | None = None):
        import onnxruntime as ort
        import requests
        from transformers import AutoTokenizer

        self.p = payload
        cache = Path(cache_dir or os.environ.get("READER_CACHE", Path.home() / ".cache" / "pulse-reader")) / payload["sha256"][:16]
        if not (cache / "reader.onnx").exists():
            cache.mkdir(parents=True, exist_ok=True)
            tar = cache / "pack.tar.gz"
            with requests.get(payload["url"], stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(tar, "wb") as f:
                    for block in r.iter_content(1 << 20):
                        f.write(block)
            if sha256(tar) != payload["sha256"]:
                tar.unlink()
                raise RuntimeError("Pulse Reader download does not match its recorded hash")
            with tarfile.open(tar) as t:
                t.extractall(cache, filter="data")
            tar.unlink()
        so = ort.SessionOptions()
        so.intra_op_num_threads = max(1, os.cpu_count() or 1)
        self.sess = ort.InferenceSession(str(cache / "reader.onnx"), so, providers=["CPUExecutionProvider"])
        self.tok = AutoTokenizer.from_pretrained(str(cache))

    def __call__(self, texts: list[str], batch: int = 64) -> list[dict]:
        out = []
        for chunk in _batches(texts, batch):
            enc = self.tok(chunk, padding=True, truncation=True, max_length=self.p.get("max_len", MAX_LEN), return_tensors="np")
            m, e, f, a = self.sess.run(None, {"input_ids": enc["input_ids"].astype("int64"),
                                              "attention_mask": enc["attention_mask"].astype("int64")})
            for i in range(len(chunk)):
                out.append(decode(m[i].tolist(), e[i].tolist(), f[i].tolist(), a[i].tolist()))
        return out

    def trusted(self, pred: dict) -> dict:
        """Only the parts of a prediction that clear their task's confidence cut-off."""
        th = self.p.get("thresholds") or {}
        keep = {}
        for task, field in [("mood", "sentiment"), ("emotion", "emotion"), ("aspects", "aspects")] + [(f, f"is_{f}") for f in FLAGS]:
            t = th.get(task)
            if t is not None and pred["conf"][task] >= t:
                keep[field] = pred[field]
                if task == "mood":
                    keep["score"] = pred["score"]
        return keep


def load_record(session: Session) -> dict | None:
    try:
        row = session.execute(text("select payload, metrics from local_models where name = :n"), {"n": NAME}).first()
    except Exception:
        session.rollback()
        return None
    if not row:
        return None
    payload = json.loads(row.payload)
    payload["metrics"] = json.loads(row.metrics or "{}")
    return payload
