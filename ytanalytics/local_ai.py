"""Free AI that runs inside the GitHub job, with no daily limit.

1. Emotions: a multilingual emotion model (XLM-R, anger / fear / joy / sadness) fills in an
   emotion for comments the online AI hasn't read yet. The online AI's richer labels replace
   these later.
2. Questions and requests: transparent patterns in English, romanized Tamil and Hindi.
3. Topics: every comment is turned into a meaning vector with a small multilingual model,
   similar comments are grouped (k-means), and each group gets keywords, a name, how people
   feel about it and a week-by-week count, so the website can show rising and falling themes.

Everything runs on the job's CPU; nothing here uses a free AI quota except one optional
request per channel per day to give the topic groups readable names.
"""
from __future__ import annotations

import json
import logging
import math
import re
import time
from collections import Counter
from datetime import timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .db import Channel, Comment, Topic, utcnow

log = logging.getLogger(__name__)

EMOTION_MODEL = "MilaNLProc/xlm-emo-t"
EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

# --------------------------------------------------------------------------- questions / requests
_Q_START = re.compile(
    r"^\s*(what|why|how|when|where|which|who|whom|whose|can you|could you|will you|would you|do you|does|did|"
    r"is it|is this|are you|are there|should i|anyone know|enna|eppo|eppadi|epdi|yen|enga|yaaru|evlo|evalo|ethuku|"
    r"kya|kyu|kyun|kaise|kab|kaha|kahan|kaun|kitna|kitne)\b", re.I)
_Q_ANY = re.compile(r"\b(enna|eppo|eppadi|epdi|evlo|evalo|ethuku|kya|kyun|kaise|kab|kitna)\b", re.I)
_REQUEST = re.compile(
    r"\b(please|pls|plz|plss|kindly|part ?\d+|next (video|part) (on|about|for)|make a video|make video|do a video|"
    r"video on|video about|video for|review (of|on)|upload|collab|waiting for|can you make|can you do|"
    r"podunga|pannunga|podungo|venum|vennum|banao|banaiye|kijiye|chahiye)\b", re.I)


def detect_question_request(text: str | None) -> tuple[bool, bool]:
    t = text or ""
    question = "?" in t or bool(_Q_START.search(t)) or bool(_Q_ANY.search(t))
    return question, bool(_REQUEST.search(t))


# --------------------------------------------------------------------------- emotions
def _load_emotion_classifier():
    from transformers import pipeline

    clf = pipeline("text-classification", model=EMOTION_MODEL, top_k=None, truncation=True, max_length=128)

    def classify(texts: list[str]) -> list[dict[str, float]]:
        out = clf(texts, batch_size=32)
        return [{d["label"].lower(): float(d["score"]) for d in row} for row in out]
    return classify


def local_emotions(session: Session, classify=None, limit: int = 4000, deadline: float | None = None) -> int:
    """Emotion + question/request flags for comments the online AI hasn't read yet."""
    rows = session.execute(
        select(Comment.id, Comment.text).where(Comment.ai_at.is_(None), Comment.emotion.is_(None))
        .order_by(Comment.published_at.desc()).limit(limit)
    ).all()
    if not rows:
        return 0
    if classify is None:
        try:
            classify = _load_emotion_classifier()
        except Exception as e:  # model download problems must not break the job
            log.warning("Local emotion model unavailable: %s", e)
            classify = None
    done = 0
    for i in range(0, len(rows), 64):
        if deadline is not None and time.monotonic() > deadline:
            break
        chunk = rows[i:i + 64]
        scores = classify([(r.text or "")[:400] for r in chunk]) if classify else [{}] * len(chunk)
        updates = []
        for r, s in zip(chunk, scores):
            question, request = detect_question_request(r.text)
            emotion = None
            if s:
                label, p = max(s.items(), key=lambda kv: kv[1])
                emotion = label if p >= 0.5 else "neutral"
            updates.append({"id": r.id, "emotion": emotion, "is_question": question, "is_suggestion": request})
        session.execute(update(Comment), updates)
        session.commit()
        done += len(updates)
    log.info("Local AI: emotions/questions for %d comments", done)
    return done


# --------------------------------------------------------------------------- topics
STOP = set("""the a an and or but if of to in on for with at by from is are was were be been this that these those
it its i you he she we they me my your our their his her them us so very too just not no yes do does did have has
had will would can could should what why how when where who which also more most much many some any all one two
get got make made like really video videos bro anna da di sir please pls plz thank thanks super nice good great
semma vera level iruku irukku ku la le ah oh ok okay u ur hai hain ka ki ke ko se ho bhi nahi kya ye wo
about here there than then into out over only even still being after before because which while""".split())
_TOKEN = re.compile(r"[^\W\d_]{3,}", re.UNICODE)


def _load_embedder():
    import torch
    from transformers import AutoModel, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(EMBED_MODEL)
    model = AutoModel.from_pretrained(EMBED_MODEL)
    model.eval()

    def embed(texts: list[str]):
        vecs = []
        with torch.no_grad():
            for i in range(0, len(texts), 64):
                enc = tok(texts[i:i + 64], padding=True, truncation=True, max_length=128, return_tensors="pt")
                out = model(**enc).last_hidden_state
                mask = enc["attention_mask"].unsqueeze(-1).float()
                v = (out * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
                vecs.append(torch.nn.functional.normalize(v, dim=1).numpy())
        import numpy as np
        return np.vstack(vecs)
    return embed


def kmeans(x, k: int, iters: int = 30, seed: int = 7):
    """Spherical k-means (cosine) with k-means++ starts. x: (n, d) unit vectors."""
    import numpy as np

    rng = np.random.default_rng(seed)
    n = len(x)
    centers = [x[rng.integers(n)]]
    for _ in range(1, k):
        d = 1 - np.max(x @ np.array(centers).T, axis=1)
        p = np.clip(d, 1e-9, None) ** 2
        centers.append(x[rng.choice(n, p=p / p.sum())])
    c = np.array(centers)
    labels = np.zeros(n, dtype=int)
    for _ in range(iters):
        new = np.argmax(x @ c.T, axis=1)
        if (new == labels).all() and _ > 0:
            break
        labels = new
        for j in range(k):
            members = x[labels == j]
            if len(members):
                m = members.sum(0)
                c[j] = m / (np.linalg.norm(m) or 1)
    return labels


def keywords(docs_by_cluster: dict[int, list[str]], top: int = 5) -> dict[int, list[str]]:
    """Class-based TF-IDF: words common in one group but not across all groups."""
    tf = {c: Counter(w for d in docs for w in _TOKEN.findall(d.lower()) if w not in STOP)
          for c, docs in docs_by_cluster.items()}
    total = Counter()
    for counts in tf.values():
        total.update(counts)
    avg = sum(sum(c.values()) for c in tf.values()) / max(1, len(tf))
    out = {}
    for c, counts in tf.items():
        size = sum(counts.values()) or 1
        scored = sorted(counts, key=lambda w: -(counts[w] / size) * math.log(1 + avg / total[w]))
        out[c] = [w for w in scored if counts[w] >= 2][:top]
    return out


NAME_SYSTEM = """You name groups of YouTube comments for a creator dashboard.
For each group you get keywords and example comments (any language). Give a short, specific
English name of 2-5 words for what the group is about (e.g. "Audio quality complaints",
"Requests for part 2", "Praise for the host's humour"). Reply with JSON only:
{"names": [{"g": group number, "name": "..."}]}"""


def build_topics(session: Session, embed=None, router=None, *, min_comments: int = 60, max_comments: int = 3000,
                 every_hours: float = 20, deadline: float | None = None, now=None) -> int:
    """Group each active channel's recent comments into themes. Returns how many channels were updated."""
    now = now or utcnow()
    updated = 0
    for ch in session.scalars(select(Channel).where(Channel.active)):
        if deadline is not None and time.monotonic() > deadline:
            break
        last = session.scalar(select(func.max(Topic.created_at)).where(Topic.channel_id == ch.id))
        if last and now - last < timedelta(hours=every_hours):
            continue
        rows = session.execute(
            select(Comment.id, Comment.text, Comment.translation, Comment.sentiment, Comment.sentiment_value,
                   Comment.like_count, Comment.published_at)
            .where(Comment.channel_id == ch.id, Comment.published_at >= now - timedelta(days=90),
                   func.length(Comment.text) >= 15, Comment.is_spam.isnot(True),
                   (Comment.ai_model.is_(None)) | (Comment.ai_model != "rules"))
            .order_by(Comment.published_at.desc()).limit(max_comments)
        ).all()
        if len(rows) < min_comments:
            continue
        if embed is None:
            try:
                embed = _load_embedder()
            except Exception as e:
                log.warning("Topic model unavailable: %s", e)
                return updated
        texts = [(r.translation or r.text or "")[:300] for r in rows]
        x = embed(texts)
        k = max(4, min(10, round(math.sqrt(len(rows) / 8))))
        labels = kmeans(x, k)
        groups: dict[int, list[int]] = {}
        for i, lab in enumerate(labels):
            groups.setdefault(int(lab), []).append(i)
        small = max(8, int(len(rows) * 0.02))
        groups = {g: idx for g, idx in groups.items() if len(idx) >= small}
        if not groups:
            continue
        kw = keywords({g: [texts[i] for i in idx] for g, idx in groups.items()})
        names = _name_groups(router, groups, kw, rows) if router else {}

        cut = now - timedelta(days=14)
        recent_total = sum(1 for r in rows if r.published_at and r.published_at >= cut) or 1
        prev_total = sum(1 for r in rows if r.published_at and cut - timedelta(days=14) <= r.published_at < cut) or 1
        session.execute(delete(Topic).where(Topic.channel_id == ch.id))
        for rank, (g, idx) in enumerate(sorted(groups.items(), key=lambda kv: -len(kv[1]))):
            members = [rows[i] for i in idx]
            values = [m.sentiment_value for m in members if m.sentiment_value is not None]
            weekly = Counter((m.published_at - timedelta(days=m.published_at.weekday())).strftime("%Y-%m-%d")
                             for m in members if m.published_at)
            recent = sum(1 for m in members if m.published_at and m.published_at >= cut)
            prev = sum(1 for m in members if m.published_at and cut - timedelta(days=14) <= m.published_at < cut)
            share_now, share_before = recent / recent_total, prev / prev_total
            trend = None if prev < 3 else round((share_now - share_before) / share_before * 100, 1)
            best = sorted(members, key=lambda m: -(m.like_count or 0))[:3]
            words = kw.get(g, [])
            session.add(Topic(
                channel_id=ch.id, created_at=now, rank=rank,
                label=(names.get(g) or " · ".join(words[:3]) or "Other")[:120],
                keywords=", ".join(words)[:300], size=len(idx), share=round(len(idx) / len(rows), 4),
                sentiment=round(sum(values) / len(values), 4) if values else None,
                negative_pct=round(100 * sum(1 for m in members if m.sentiment == "negative") / len(members), 1),
                recent=recent, trend_pct=trend,
                weekly=json.dumps(dict(sorted(weekly.items())[-12:])),
                examples=json.dumps([{"id": m.id, "text": (m.text or "")[:220], "likes": m.like_count or 0} for m in best],
                                    ensure_ascii=False),
            ))
        session.commit()
        updated += 1
        log.info("Topics: %d groups for %s from %d comments", len(groups), ch.title, len(rows))
    return updated


def _name_groups(router, groups, kw, rows) -> dict[int, str]:
    from .llm import NoModelAvailable

    lines = []
    for g, idx in groups.items():
        examples = sorted((rows[i] for i in idx), key=lambda r: -(r.like_count or 0))[:3]
        lines.append(f"Group {g}: keywords: {', '.join(kw.get(g, []))}")
        lines += [f"  - {' '.join((e.text or '').split())[:160]}" for e in examples]
    try:
        data, _ = router.chat_json(NAME_SYSTEM, "\n".join(lines), max_tokens=800)
    except NoModelAvailable:
        return {}
    out = {}
    for item in data.get("names") or []:
        try:
            out[int(item.get("g"))] = str(item.get("name", "")).strip()[:120]
        except (TypeError, ValueError, AttributeError):
            continue
    return {g: n for g, n in out.items() if n}


def topics_due(session: Session, every_hours: float = 20) -> bool:
    now = utcnow()
    for ch_id in session.scalars(select(Channel.id).where(Channel.active)):
        last = session.scalar(select(func.max(Topic.created_at)).where(Topic.channel_id == ch_id))
        if not last or now - last >= timedelta(hours=every_hours):
            return True
    return False
