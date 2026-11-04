"""Language detection + multilingual sentiment for every stored comment.

The default model (XLM-RoBERTa trained on ~200M tweets in many languages) runs for free
on the GitHub Actions CPU. It handles comments written in native scripts (Tamil, Hindi,
etc.) well; romanized / code-mixed text such as Tanglish is weaker and is the job of the
LLM layer planned for phase 2.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Callable, Protocol, Sequence

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .config import Settings
from .db import Comment, RunLog, utcnow

log = logging.getLogger(__name__)

# Unicode script ranges -> language code. Checked before the statistical detector,
# which is unreliable on short comments.
_SCRIPTS: list[tuple[str, str]] = [
    ("ta", r"[஀-௿]"),   # Tamil
    ("te", r"[ఀ-౿]"),   # Telugu
    ("kn", r"[ಀ-೿]"),   # Kannada
    ("ml", r"[ഀ-ൿ]"),   # Malayalam
    ("bn", r"[ঀ-৿]"),   # Bengali
    ("gu", r"[઀-૿]"),   # Gujarati
    ("pa", r"[਀-੿]"),   # Gurmukhi (Punjabi)
    ("or", r"[଀-୿]"),   # Odia
    ("si", r"[඀-෿]"),   # Sinhala
    ("th", r"[฀-๿]"),   # Thai
    ("ko", r"[가-힯]"),   # Korean
    ("ja", r"[぀-ヿ]"),   # Japanese kana
    ("zh", r"[一-鿿]"),   # Chinese
    ("ar", r"[؀-ۿ]"),   # Arabic script (also Urdu)
    ("he", r"[֐-׿]"),   # Hebrew
    ("ru", r"[Ѐ-ӿ]"),   # Cyrillic
    ("el", r"[Ͱ-Ͽ]"),   # Greek
]
_SCRIPT_RES = [(code, re.compile(pat)) for code, pat in _SCRIPTS]
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def detect_language(text: str) -> str:
    """Best-effort language code. 'und' = could not tell (emoji only, too short...)."""
    text = (text or "").strip()
    letters = _LETTER.findall(text)
    if len(letters) < 2:
        return "und"
    counts: dict[str, int] = {}
    for code, rx in _SCRIPT_RES:
        n = len(rx.findall(text))
        if n:
            counts[code] = n
    deva = len(_DEVANAGARI.findall(text))
    if deva:
        counts["hi"] = deva  # Hindi/Marathi/Nepali; refined below
    if counts:
        best = max(counts, key=counts.get)
        if counts[best] >= 0.3 * len(letters):
            if best == "hi":
                return _langdetect(text, allowed={"hi", "mr", "ne"}) or "hi"
            if best == "ar":
                return _langdetect(text, allowed={"ar", "ur", "fa"}) or "ar"
            return best
    hint = _latin_hint(text)
    if hint:
        return hint
    return _langdetect(text) or "und"


# Romanized Indian languages are invisible to script detection and confuse langdetect,
# so look for common marker words. "-Latn" means "written in the Latin alphabet".
_ROMANIZED_MARKERS = {
    "ta-Latn": {"semma", "sema", "romba", "nalla", "enna", "thala", "machi", "machan", "iruku",
                "irukku", "pannunga", "panna", "vera", "kalakkal", "vazhthukkal", "nandri", "nanri",
                "thalaivar", "thalaiva", "anna", "akka", "illa", "seri", "sari", "unga", "enga",
                "naan", "neenga", "paaru", "padam", "superu", "mokka", "vaa", "podu", "kadavul"},
    "hi-Latn": {"bhai", "bahut", "bohot", "accha", "acha", "kya", "hai", "nahi", "nhi", "yaar",
                "mast", "bhi", "aur", "kar", "tha", "hain", "kuch", "kyun", "mujhe", "aap", "apka",
                "aapka", "bhot", "badhiya", "zabardast", "sahi", "dil", "hum", "tum", "kaise"},
}
_EN_COMMON = {"the", "a", "is", "and", "to", "of", "this", "that", "it", "you", "i", "my", "for",
              "video", "videos", "great", "good", "bad", "love", "nice", "best", "worst", "so",
              "very", "thanks", "thank", "please", "awesome", "amazing", "what", "who", "how",
              "why", "was", "are", "not", "with", "on", "in", "your", "me", "we", "be", "first",
              "content", "more", "make", "like", "just", "really", "watch", "channel", "song"}
_WORD = re.compile(r"[a-z']+")


def _latin_hint(text: str) -> str | None:
    words = _WORD.findall(text.lower())
    if not words:
        return None
    for code, markers in _ROMANIZED_MARKERS.items():
        if sum(w in markers for w in words) >= max(1, len(words) // 4):
            return code
    if len(words) <= 6 and sum(w in _EN_COMMON for w in words) >= max(1, len(words) // 2):
        return "en"
    return None


def _langdetect(text: str, allowed: set[str] | None = None) -> str | None:
    try:
        from langdetect import DetectorFactory, detect_langs
        DetectorFactory.seed = 0  # deterministic results
        for guess in detect_langs(text):
            if allowed is None or guess.lang in allowed:
                return guess.lang.split("-")[0]
    except Exception:  # langdetect raises on text with no features
        return None
    return None


class Classifier(Protocol):
    name: str

    def __call__(self, texts: Sequence[str]) -> list[dict[str, float]]:
        """Return one {"negative": p, "neutral": p, "positive": p} dict per text."""


class HFClassifier:
    """Hugging Face transformers model running on CPU."""

    def __init__(self, model_name: str, batch_size: int = 32):
        from transformers import pipeline  # imported lazily: heavy

        self.name = model_name
        self.batch_size = batch_size
        self._pipe = pipeline(
            "text-classification",
            model=model_name,
            top_k=None,
            truncation=True,
            max_length=256,
        )

    def __call__(self, texts: Sequence[str]) -> list[dict[str, float]]:
        outputs = self._pipe(list(texts), batch_size=self.batch_size)
        results = []
        for scores in outputs:
            probs = {_normalize_label(s["label"]): float(s["score"]) for s in scores}
            results.append(probs)
        return results


_LABEL_MAP = {
    "label_0": "negative", "label_1": "neutral", "label_2": "positive",
    "neg": "negative", "neu": "neutral", "pos": "positive",
    "very negative": "negative", "very positive": "positive",
}


def _normalize_label(label: str) -> str:
    key = label.strip().lower()
    return _LABEL_MAP.get(key, key)


def summarize_probs(probs: dict[str, float]) -> tuple[str, float, float]:
    """(label, confidence, value in -1..+1)."""
    neg = probs.get("negative", 0.0)
    neu = probs.get("neutral", 0.0)
    pos = probs.get("positive", 0.0)
    label, conf = max((("negative", neg), ("neutral", neu), ("positive", pos)), key=lambda x: x[1])
    return label, conf, pos - neg


def _clean(text: str) -> str:
    text = re.sub(r"https?://\S+", "http", text or "")
    text = re.sub(r"@\S+", "@user", text)
    return text.strip()[:1000] or "."


def analyze_pending(
    session: Session,
    settings: Settings,
    classifier: Classifier | None = None,
    classifier_factory: Callable[[], Classifier] | None = None,
    limit: int | None = None,
) -> int:
    """Label every comment that has not been analyzed yet. Returns how many were done."""
    deadline = time.monotonic() + settings.max_run_minutes * 60
    run = RunLog(kind="analyze")
    session.add(run)
    session.commit()
    done = 0
    try:
        while limit is None or done < limit:
            if time.monotonic() > deadline:
                break
            batch_size = settings.analyze_batch_size
            if limit is not None:
                batch_size = min(batch_size, limit - done)
            rows = session.execute(
                select(Comment.id, Comment.text)
                .where(Comment.analyzed_at.is_(None))
                .order_by(Comment.published_at.desc())
                .limit(batch_size)
            ).all()
            if not rows:
                break
            if classifier is None:
                classifier = (classifier_factory or (lambda: HFClassifier(settings.sentiment_model)))()
            texts = [_clean(r.text) for r in rows]
            probs = classifier(texts)
            now = utcnow()
            updates = []
            for r, p in zip(rows, probs):
                label, conf, value = summarize_probs(p)
                updates.append({
                    "id": r.id,
                    "language": detect_language(r.text),
                    "sentiment": label,
                    "sentiment_score": round(conf, 4),
                    "sentiment_value": round(value, 4),
                    "analyzed_at": now,
                    "analyzer": classifier.name,
                    "sentiment_source": "model",
                })
            # Bulk update by primary key: batched into few round trips on Postgres.
            session.execute(update(Comment), updates)
            session.commit()
            done += len(rows)
            log.info("analyzed %d comments", done)
        run.status = "ok"
    except Exception as e:
        session.rollback()
        run.status = "error"
        run.summary = json.dumps({"analyzed": done, "error": repr(e)[:1000]})
        run.finished_at = utcnow()
        session.commit()
        raise
    run.summary = json.dumps({"analyzed": done})
    run.finished_at = utcnow()
    session.commit()
    return done


def count_pending(session: Session) -> int:
    from sqlalchemy import func

    return session.scalar(select(func.count()).select_from(Comment).where(Comment.analyzed_at.is_(None))) or 0
