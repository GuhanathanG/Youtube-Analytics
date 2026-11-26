"""Our own writing model at work: when every free cloud AI model is out for the day, the Pulse Analyst (trained on
Kaggle, a ~1 GB GGUF file) writes the waiting video insights on GitHub's free CPU with llama.cpp.

Its insights are saved with model "local/pulse-analyst", shown as written by our own model, and replaced by the cloud
AI's when it is available again. They are never used as training examples. Needs llama-cpp-python (CPU wheel)."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
import urllib.request
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from .ai import VIDEO_SYSTEM, AIRunner
from .db import Insight
from .analyst import MAX_PROMPT_CHARS, MIN_SAMPLE, NAME

log = logging.getLogger(__name__)
MODEL_TAG = "local/pulse-analyst"
KEYS = ("summary", "mood", "liked", "complaints", "requests", "questions", "topics", "language_notes")


def record(session: Session) -> dict | None:
    try:
        row = session.execute(text("select payload from local_models where name = :n"), {"n": NAME}).first()
    except Exception:  # noqa: BLE001
        session.rollback()
        return None
    return json.loads(row[0]) if row else None


def waiting(session: Session) -> list:
    """Videos due an insight that our own writer may write (it never redoes its own)."""
    return AIRunner(session, router=None)._videos_needing_insight(replace_local=False)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def model_file(rec: dict, cache: str | Path | None = None) -> Path:
    """Download the model in use once (cached by its checksum) and check it."""
    cache = Path(cache or os.environ.get("ANALYST_CACHE", "~/.cache/pulse-analyst")).expanduser()
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / f"{rec['sha256'][:16]}.gguf"
    if path.exists() and path.stat().st_size > 0:
        return path
    tmp = path.with_suffix(".part")
    log.info("Downloading the Pulse Analyst (%s)", rec["url"])
    with urllib.request.urlopen(rec["url"], timeout=60) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    if _sha256(tmp) != rec["sha256"]:
        tmp.unlink(missing_ok=True)
        raise ValueError("downloaded Pulse Analyst doesn't match its recorded checksum")
    tmp.rename(path)
    for old in cache.glob("*.gguf"):  # keep only the model in use
        if old != path:
            old.unlink(missing_ok=True)
    return path


def parse(text_out: str) -> dict | None:
    """The model's JSON insight, or None if it isn't usable."""
    m = re.search(r"\{.*\}", text_out, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return None
    if not isinstance(data, dict) or not str(data.get("summary", "")).strip():
        return None
    return {k: data[k] for k in KEYS if k in data} | {"written_by": "Pulse Analyst (our own model)"}


def write_insights(session: Session, max_n: int = 3, deadline: float | None = None, llm=None) -> dict:
    """Write up to max_n waiting video insights. `llm` (anything with create_chat_completion) is injectable for tests."""
    videos = waiting(session)
    if not videos:
        return {"written": 0, "waiting": 0}
    if llm is None:
        rec = record(session)
        if not rec or not rec.get("url") or not rec.get("sha256"):
            return {"written": 0, "waiting": len(videos), "reason": "no Pulse Analyst trained yet"}
        from llama_cpp import Llama

        llm = Llama(model_path=str(model_file(rec)), n_ctx=4096, n_threads=os.cpu_count() or 4, verbose=False)
    runner = AIRunner(session, router=None)
    written, bad = 0, 0
    for video in videos:
        if written >= max_n or (deadline is not None and time.time() > deadline - 60):
            break
        prompt, total, n = runner.video_prompt(video)
        if n < MIN_SAMPLE:
            continue
        t0 = time.time()
        out = llm.create_chat_completion(messages=[{"role": "system", "content": VIDEO_SYSTEM},
                                                   {"role": "user", "content": prompt[:MAX_PROMPT_CHARS]}], max_tokens=900, temperature=0)
        data = parse(out["choices"][0]["message"]["content"])
        if data is None:
            bad += 1
            log.warning("Pulse Analyst wrote no usable insight for %s", video.id)
            continue
        session.add(Insight(scope="video", target_id=video.id, comment_count=total, model=MODEL_TAG,
                            data=json.dumps(data, ensure_ascii=False)))
        session.commit()
        written += 1
        log.info("Pulse Analyst wrote the insight for %s in %.0fs", video.id, time.time() - t0)
    return {"written": written, "unusable": bad, "waiting": len(videos) - written}
