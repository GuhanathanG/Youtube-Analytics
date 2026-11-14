"""E5: our own Tanglish-aware mood model, trained for free on the nightly worker.

How: the multilingual sentence model we already run (paraphrase-multilingual-MiniLM-L12-v2) turns each comment
into a vector; a small logistic-regression "head" on top learns mood from
  * our own comments the cloud AI (Gemini) already labelled — the creators' real audience, Tanglish included, and
  * the public TamilMixSentiment dataset (15.7k labelled Tamil-English YouTube comments), when it can be fetched.
It is checked on held-out Gemini-labelled comments against the current model (XLM-RoBERTa) and only switched on
when it agrees with Gemini at least as often. Saved as a few kilobytes of numbers in the database (local_models),
so the analyse step can use it with no extra download.
"""
from __future__ import annotations

import json
import logging
import os
import random
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)
LABELS = ["negative", "neutral", "positive"]
TAMILMIX_ROWS = "https://datasets-server.huggingface.co/rows?dataset=community-datasets%2Ftamilmixsentiment&config=default&split=train"


def ensure_table(session: Session) -> None:
    session.execute(text("""create table if not exists local_models (
        name text primary key, trained_at timestamp not null, metrics text, payload text)"""))
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        session.execute(text("alter table local_models enable row level security"))
    session.commit()


def _clean(t: str) -> str:
    from .sentiment import _clean as clean

    return clean(t)


def training_rows(session: Session, per_class: int) -> list[tuple[str, str]]:
    """Gemini-labelled comments, balanced across moods (at most per_class each)."""
    out: list[tuple[str, str]] = []
    for label in LABELS:
        rows = session.execute(text("""select text from comments where sentiment_source = 'ai' and sentiment = :s
            and length(text) between 2 and 600 order by id limit :n"""), {"s": label, "n": per_class}).all()
        out.extend((_clean(r.text), label) for r in rows)
    return out


def tamilmix_rows(limit: int = 16000, http=None) -> list[tuple[str, str]]:
    """Best effort: the public TamilMixSentiment set via Hugging Face's datasets API (Positive/Negative/Mixed only)."""
    import requests

    get = (http or requests).get
    names = None
    out: list[tuple[str, str]] = []
    try:
        for offset in range(0, limit, 100):
            r = get(f"{TAMILMIX_ROWS}&offset={offset}&length=100", timeout=20)
            if r.status_code != 200:
                break
            data = r.json()
            if names is None:
                feat = next((f for f in data.get("features", []) if f.get("name") == "label"), {})
                names = feat.get("type", {}).get("names") or []
            rows = data.get("rows", [])
            for row in rows:
                rr = row.get("row", {})
                name = names[rr["label"]] if isinstance(rr.get("label"), int) and rr["label"] < len(names) else str(rr.get("label"))
                mood = {"Positive": "positive", "Negative": "negative", "Mixed_feelings": "neutral"}.get(name)
                if mood and rr.get("text"):
                    out.append((_clean(rr["text"]), mood))
            if len(rows) < 100:
                break
    except Exception as e:  # never fail training over the extra data
        log.warning("TamilMixSentiment not fetched: %s", e)
    return out


def macro_f1(truth: list[str], pred: list[str]) -> float:
    f1s = []
    for c in LABELS:
        tp = sum(t == c and p == c for t, p in zip(truth, pred))
        fp = sum(t != c and p == c for t, p in zip(truth, pred))
        fn = sum(t == c and p != c for t, p in zip(truth, pred))
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1s.append(2 * prec * rec / (prec + rec) if prec + rec else 0.0)
    return sum(f1s) / len(f1s)


def train_tanglish(session: Session, embed=None, baseline=None, extra=None) -> dict:
    """Train the head, compare with the current model, save. embed/baseline/extra are injectable for tests."""
    import numpy as np
    from sklearn.linear_model import LogisticRegression

    ensure_table(session)
    per_class = int(os.environ.get("TANGLISH_PER_CLASS", "8000"))
    ours = training_rows(session, per_class)
    if len(ours) < 300:
        return {"trained": False, "reason": f"only {len(ours)} AI-labelled comments yet"}
    rnd = random.Random(11)
    rnd.shuffle(ours)
    n_test = max(150, min(1500, len(ours) // 7))
    test, train = ours[:n_test], ours[n_test:]
    public = (extra if extra is not None else tamilmix_rows()) if os.environ.get("TANGLISH_PUBLIC", "1") == "1" else []
    train = train + public

    if embed is None:
        from .local_ai import _load_embedder

        embed = _load_embedder()
    x_train = embed([t for t, _ in train])
    x_test = embed([t for t, _ in test])
    head = LogisticRegression(max_iter=2000, C=float(os.environ.get("TANGLISH_C", "4")), class_weight="balanced")
    head.fit(x_train, [y for _, y in train])
    pred = list(head.predict(x_test))
    truth = [y for _, y in test]
    ours_f1 = macro_f1(truth, pred)
    ours_acc = float(np.mean([a == b for a, b in zip(truth, pred)]))

    # The current model on the same held-out comments.
    base_f1 = base_acc = None
    try:
        if baseline is None:
            from .config import Settings
            from .sentiment import HFClassifier

            baseline = HFClassifier(Settings.from_env().sentiment_model)
        from .sentiment import summarize_probs

        bpred = [summarize_probs(p)[0] for p in baseline([t for t, _ in test])]
        base_f1, base_acc = macro_f1(truth, bpred), float(np.mean([a == b for a, b in zip(truth, bpred)]))
    except Exception as e:
        log.warning("Couldn't score the current model for comparison: %s", e)
    use = base_f1 is None or ours_f1 >= base_f1
    metrics = {"tested": len(test), "trained_on": len(train), "public_rows": len(public), "macro_f1": round(ours_f1, 4),
               "accuracy": round(ours_acc, 4), "current_macro_f1": None if base_f1 is None else round(base_f1, 4),
               "current_accuracy": None if base_acc is None else round(base_acc, 4), "in_use": use}
    classes = [str(c) for c in head.classes_]
    payload = {"embed_model": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", "classes": classes,
               "coef": np.round(head.coef_, 6).tolist(), "intercept": np.round(head.intercept_, 6).tolist()}
    now = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    session.execute(text("delete from local_models where name = 'tanglish'"))
    session.execute(text("insert into local_models (name, trained_at, metrics, payload) values ('tanglish', :t, :m, :p)"),
                    {"t": now, "m": json.dumps(metrics), "p": json.dumps(payload)})
    session.commit()
    log.info("Tanglish mood model: %s", metrics)
    return {"trained": True, **metrics}


class HeadClassifier:
    """The trained head on top of the sentence model: same interface as sentiment.HFClassifier."""

    def __init__(self, payload: dict, embed=None):
        import numpy as np

        if embed is None:
            from .local_ai import _load_embedder

            embed = _load_embedder()
        self.embed = embed
        self.classes = payload["classes"]
        self.coef = np.array(payload["coef"])
        self.intercept = np.array(payload["intercept"])
        self.name = "tanglish-head/minilm"

    def __call__(self, texts):
        import numpy as np

        z = self.embed(list(texts)) @ self.coef.T + self.intercept
        z = z - z.max(axis=1, keepdims=True)
        p = np.exp(z)
        p = p / p.sum(axis=1, keepdims=True)
        return [{c: float(v) for c, v in zip(self.classes, row)} for row in p]


def load_head(session: Session, embed=None):
    """The trained head if it's switched on, else None (the analyse step then uses the default model)."""
    try:
        row = session.execute(text("select metrics, payload from local_models where name = 'tanglish'")).first()
    except Exception:
        session.rollback()
        return None
    if not row or not json.loads(row.metrics or "{}").get("in_use"):
        return None
    return HeadClassifier(json.loads(row.payload), embed=embed)
