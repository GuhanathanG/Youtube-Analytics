"""Watchdog: keeps every scheduled job (training included) running by itself, with no one pressing buttons.

GitHub's timer sometimes skips scheduled runs when it is busy, and it switches scheduled workflows off after a long
quiet spell in a repository. The watchdog runs at the end of every 30-minute sync and, for each job below:
  - switches the workflow back on if GitHub disabled it, and re-confirms it as active once a day;
  - starts it if its last run is older than its schedule plus some slack (a skipped timer);
  - retries it once, 30 minutes after a failure;
  - after two failures in a row, stops retrying until the next regular slot and sends one alert
    (Model Lab / alerts page, plus Telegram when it is set up).
It uses the sync job's own GitHub token (no extra secrets) and costs nothing on a public repository.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Job:
    file: str
    name: str
    every_h: float  # its schedule
    slack_h: float  # how late it may be before the watchdog starts it (runs can take hours)


JOBS = [
    Job("training.yml", "Training channels", 6, 3),
    Job("archive-read.yml", "Archive reading", 6, 4),
    Job("model.yml", "Creator Model", 24, 6),
    Job("reader.yml", "Pulse Reader", 24 * 7, 24),
    Job("analyst.yml", "Pulse Analyst", 24 * 14, 48),
]
KEEP_ALIVE = [j.file for j in JOBS] + ["sync.yml"]
ACTIVE = {"queued", "in_progress", "waiting", "requested", "pending"}
FAILED = {"failure", "timed_out", "startup_failure"}
RETRY_AFTER = timedelta(minutes=30)


def _when(s: str | datetime) -> datetime:
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def decide(job: Job, runs: list[dict], now: datetime) -> tuple[str, str]:
    """runs: newest first ({status, conclusion, created_at}). Returns (action, reason);
    action is one of ok / wait / start / retry / alert."""
    if any(r.get("status") in ACTIVE for r in runs):
        return "wait", "running now"
    if not runs:
        return "start", "has never run"
    last = runs[0]
    age = now - _when(last["created_at"])
    due = timedelta(hours=job.every_h + job.slack_h)
    fails = 0
    for r in runs:
        if r.get("conclusion") not in FAILED:
            break
        fails += 1
    if fails == 1:
        return ("retry", "last run failed: trying once more") if age >= RETRY_AFTER else ("wait", "failed; retrying soon")
    if fails >= 2:
        if age >= due:
            return "start", f"failed {fails} times; trying again at its next slot"
        return "alert", f"failed {fails} times in a row"
    if age >= due:
        return "start", f"last ran {age.total_seconds() / 3600:.0f} h ago (due every {job.every_h:g} h): the timer skipped it"
    return "ok", "on schedule"


class GitHub:
    def __init__(self, token: str, repo: str, api: str = "https://api.github.com"):
        self.token, self.repo, self.api = token, repo, api.rstrip("/")

    def call(self, method: str, path: str, body: dict | None = None):
        req = urllib.request.Request(f"{self.api}/repos/{self.repo}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                                              "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "creator-pulse-watchdog"})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    def runs(self, file: str) -> list[dict]:
        data = self.call("GET", f"/actions/workflows/{file}/runs?per_page=5&exclude_pull_requests=true")
        return [{"id": r["id"], "status": r["status"], "conclusion": r.get("conclusion"), "created_at": r["created_at"],
                 "url": r.get("html_url")} for r in (data or {}).get("workflow_runs", [])]

    def state(self, file: str) -> str:
        return (self.call("GET", f"/actions/workflows/{file}") or {}).get("state", "")

    def enable(self, file: str) -> None:
        self.call("PUT", f"/actions/workflows/{file}/enable")

    def dispatch(self, file: str, ref: str = "main") -> None:
        self.call("POST", f"/actions/workflows/{file}/dispatches", {"ref": ref})


def _alert(session: Session, job: Job, run: dict, reason: str) -> bool:
    from .health import send_telegram

    title = f"⚠️ {job.name} keeps failing"
    body = f"{job.name} {reason}. It will try again at its next regular slot. Details: {run.get('url') or 'GitHub Actions'}"
    try:
        inserted = session.execute(text(
            "INSERT INTO alerts (kind, key, title, body, link) VALUES ('health', :k, :t, :b, '/lab') "
            "ON CONFLICT (key) DO NOTHING RETURNING id"), {"k": f"watchdog:{job.file}:{run['id']}", "t": title, "b": body}).first()
        session.commit()
    except Exception:  # alerts table not there yet
        session.rollback()
        return False
    if inserted:
        send_telegram(f"{title}\n{body}")
    return bool(inserted)


def run(session: Session | None, gh: GitHub | None = None, now: datetime | None = None, keep_alive: bool | None = None) -> list[str]:
    if gh is None:
        token, repo = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
        if not token or not repo:
            return ["watchdog: no GitHub token here; skipped"]
        gh = GitHub(token, repo)
    now = now or datetime.now(timezone.utc)
    if keep_alive is None:
        keep_alive = now.hour == 3 and now.minute < 30  # once a day
    out = []
    for file in KEEP_ALIVE:
        try:
            st = gh.state(file)
            if st != "active" or keep_alive:
                gh.enable(file)  # also resets GitHub's inactivity timer
                if st != "active":
                    out.append(f"{file}: was {st or 'unknown'}, switched back on")
        except (urllib.error.URLError, ValueError, KeyError) as e:
            out.append(f"{file}: couldn't check ({e})")
    for job in JOBS:
        try:
            runs = gh.runs(job.file)
            action, reason = decide(job, runs, now)
            if action in ("start", "retry"):
                gh.dispatch(job.file)
            elif action == "alert" and session is not None:
                if _alert(session, job, runs[0], reason):
                    reason += ": alert sent"
            out.append(f"{job.name}: {action} ({reason})")
        except (urllib.error.URLError, ValueError, KeyError) as e:
            out.append(f"{job.name}: couldn't check ({e})")
    return out
