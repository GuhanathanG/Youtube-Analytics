"""Pulse Analyst (#5): our own small writing model for video insights, trained on Kaggle's free GPU.

Training pairs are rebuilt from insights the cloud AI already wrote: for each video insight, the same prompt the AI
got (title, stats, a sample of comments posted before the insight; no commenter names) and the JSON it answered.
A fixed 10% (hash of the video id) is held out to test the model against the cloud AI's answers.
The GitHub workflow (analyst.yml) uploads the pairs as a private Kaggle dataset, runs kaggle/analyst_train.py on a
private GPU notebook, downloads the result (a small GGUF file that runs on CPU), publishes it as a release and records
it here (local_models row "pulse-analyst").
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .ai import VIDEO_SYSTEM, AIRunner
from .db import Insight, Video

log = logging.getLogger(__name__)
NAME = "pulse-analyst"
MAX_PROMPT_CHARS = 7000
MIN_SAMPLE = 15


def held_out(video_id: str) -> bool:
    return int(hashlib.md5(video_id.encode()).hexdigest()[:8], 16) % 10 == 0


def export(session: Session, out_dir: str | Path) -> dict:
    """Write train.jsonl / test.jsonl ({"system", "prompt", "response"} per line). Returns counts."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    runner = AIRunner(session, router=None)  # only its prompt building is used
    latest: dict[str, Insight] = {}
    for ins in session.scalars(select(Insight).where(Insight.scope == "video").order_by(Insight.created_at)):
        if (ins.model or "").startswith("rules"):
            continue
        latest[ins.target_id] = ins  # newest insight per video
    counts = {"train": 0, "test": 0, "skipped_thin": 0, "skipped_missing": 0}
    with open(out / "train.jsonl", "w") as tr, open(out / "test.jsonl", "w") as te:
        for vid, ins in latest.items():
            video = session.get(Video, vid)
            if video is None:
                counts["skipped_missing"] += 1
                continue
            prompt, _total, n = runner.video_prompt(video, before=ins.created_at)
            if n < MIN_SAMPLE:
                counts["skipped_thin"] += 1  # comments since moved to the archive: too little left to learn from
                continue
            try:
                response = json.dumps(json.loads(ins.data), ensure_ascii=False)
            except ValueError:
                counts["skipped_missing"] += 1
                continue
            row = json.dumps({"system": VIDEO_SYSTEM, "prompt": prompt[:MAX_PROMPT_CHARS], "response": response}, ensure_ascii=False)
            if held_out(vid):
                te.write(row + "\n")
                counts["test"] += 1
            else:
                tr.write(row + "\n")
                counts["train"] += 1
    (out / "counts.json").write_text(json.dumps(counts))
    return counts


def save_record(session: Session, metrics: dict, url: str, digest: str) -> None:
    from .tanglish import ensure_table

    ensure_table(session)
    session.execute(text("delete from local_models where name = :n"), {"n": NAME})
    session.execute(text("insert into local_models (name, trained_at, metrics, payload) values (:n, now() at time zone 'utc', :m, :p)"),
                    {"n": NAME, "m": json.dumps(metrics), "p": json.dumps({"url": url, "sha256": digest, "format": "gguf"})})
    session.commit()


MIN_GROWTH = 0.10  # retrain on a schedule only when at least 10% more examples exist than the model in use saw


def due(session: Session, counts: dict) -> tuple[bool, str]:
    """Whether a scheduled run should train: there is no model yet, or the training examples grew enough."""
    now = int(counts.get("train", 0))
    try:
        row = session.execute(text("select metrics from local_models where name = :n"), {"n": NAME}).first()
    except Exception:
        session.rollback()
        row = None
    if row is None:
        return True, f"no Pulse Analyst yet: training on {now} examples"
    try:
        before = int(json.loads(row[0]).get("train_pairs", 0))
    except (TypeError, ValueError):
        return True, "previous results unreadable: training"
    if now > before and (now - before) >= before * MIN_GROWTH - 1e-9:
        return True, f"{now} examples vs {before} last time: training"
    return False, f"only {now - before} new examples since the last model ({before}): skipped until there are {int(before * MIN_GROWTH) + 1}+ new"
