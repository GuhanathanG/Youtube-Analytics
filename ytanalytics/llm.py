"""Free AI models behind one interface, with automatic fallback.

Google Gemini and Groq both speak the OpenAI "chat completions" format, so one small
client covers both. Models are tried in order; when a model hits its free daily limit
(or does not exist for your key), the next one is used. Usage is counted per day in the
`llm_usage` table so we never hammer a model that is already exhausted.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field

import requests
from sqlalchemy.orm import Session

from .db import LlmUsage
from .youtube import quota_day

log = logging.getLogger(__name__)


class NoModelAvailable(Exception):
    """Every configured model is exhausted for today (or none is configured)."""


@dataclass
class ModelSlot:
    provider: str
    base_url: str
    api_key: str
    model: str
    daily_requests: int
    seconds_between: float
    extra: dict = field(default_factory=dict)
    json_mode: bool = True
    last_call: float = 0.0

    @property
    def key(self) -> str:
        return f"{self.provider}/{self.model}"


PROVIDERS = {
    # name: (base url, env prefix, default models, default daily requests per model, seconds between calls)
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "GEMINI",
               "gemini-2.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash-lite,gemini-3.8-flash", 200, 7.0),
    "groq": ("https://api.groq.com/openai/v1/", "GROQ",
             "openai/gpt-oss-20b,openai/gpt-oss-120b", 900, 30.0),
}


def reasoning_for(provider: str, model: str) -> str:
    """Least 'thinking' each model allows: thinking makes answers slow, and labelling
    comments doesn't need it. Gemini 2.5 can switch it off; Gemini 3 only down to minimal."""
    if provider == "gemini":
        return "none" if model.startswith("gemini-2.5") else "minimal"
    return "low"


REQUEST_TIMEOUT = float(os.environ.get("AI_REQUEST_TIMEOUT", "45"))


def slots_from_env(env: dict | None = None) -> list[ModelSlot]:
    """Build the ordered list of models from environment variables / secrets.

    GEMINI_API_KEY, GROQ_API_KEY            - enable a provider
    GEMINI_MODELS, GROQ_MODELS              - comma-separated, tried in order
    GEMINI_DAILY_REQUESTS, GROQ_DAILY_REQUESTS
    GEMINI_SECONDS_BETWEEN, GROQ_SECONDS_BETWEEN
    AI_PROVIDER_ORDER                       - default "gemini,groq"
    """
    env = env if env is not None else os.environ
    order = [p.strip() for p in env.get("AI_PROVIDER_ORDER", "gemini,groq").split(",") if p.strip()]
    slots: list[ModelSlot] = []
    for name in order:
        if name not in PROVIDERS:
            continue
        base_url, prefix, models, daily, gap = PROVIDERS[name]
        key = env.get(f"{prefix}_API_KEY", "").strip()
        if not key:
            continue
        for model in [m.strip() for m in env.get(f"{prefix}_MODELS", models).split(",") if m.strip()]:
            extra = {"reasoning_effort": reasoning_for(name, model)}
            slots.append(ModelSlot(
                provider=name,
                base_url=base_url,
                api_key=key,
                model=model,
                daily_requests=int(env.get(f"{prefix}_DAILY_REQUESTS", daily)),
                seconds_between=float(env.get(f"{prefix}_SECONDS_BETWEEN", gap)),
                extra=extra,
            ))
    return slots


class LLMRouter:
    def __init__(self, session: Session, slots: list[ModelSlot], http: requests.Session | None = None,
                 sleep=time.sleep):
        self.s = session
        self.slots = slots
        self.http = http or requests.Session()
        self.sleep = sleep
        self.errors: dict[str, str] = {}  # model -> problem seen in this run (bad key, etc.)

    # -- usage bookkeeping --------------------------------------------------------
    def _usage(self, slot: ModelSlot) -> LlmUsage:
        day = quota_day()
        row = self.s.get(LlmUsage, (day, slot.key))
        if row is None:
            row = LlmUsage(day=day, model_key=slot.key, requests=0, tokens=0, exhausted=False)
            self.s.add(row)
        return row

    def available(self, slot: ModelSlot) -> bool:
        if slot.key in self.errors:
            return False
        row = self._usage(slot)
        return not row.exhausted and row.requests < slot.daily_requests

    def any_available(self) -> bool:
        return any(self.available(s) for s in self.slots)

    def _mark_exhausted(self, slot: ModelSlot, reason: str) -> None:
        row = self._usage(slot)
        row.exhausted = True
        row.last_error = reason[:1000]
        self.s.commit()
        log.warning("AI model %s unavailable for today: %s", slot.key, reason[:200])

    # -- calling ------------------------------------------------------------------
    def chat_json(self, system: str, user: str, max_tokens: int = 4096,
                  deadline: float | None = None) -> tuple[dict, str]:
        """Send a prompt, get parsed JSON back. Returns (data, model_key)."""
        if not self.slots:
            raise NoModelAvailable("No AI key configured (set GEMINI_API_KEY and/or GROQ_API_KEY)")
        for slot in self.slots:
            if deadline is not None and time.monotonic() > deadline:
                raise NoModelAvailable("Out of time for this run; the next run continues")
            if not self.available(slot):
                continue
            result = self._try_slot(slot, system, user, max_tokens, deadline)
            if result is not None:
                return result, slot.key
        if deadline is not None and time.monotonic() > deadline:
            raise NoModelAvailable("Out of time for this run; the next run continues")
        if any(s.key in self.errors for s in self.slots):
            raise NoModelAvailable("No AI model answered in time this run: " + "; ".join(
                f"{k}: {v}" for k, v in self.errors.items()))
        raise NoModelAvailable("All AI models are used up for today; they reset at midnight Pacific time")

    def _try_slot(self, slot: ModelSlot, system: str, user: str, max_tokens: int,
                  deadline: float | None) -> dict | None:
        bad_json = 0
        for attempt in range(4):
            if deadline is not None and time.monotonic() > deadline:
                return None
            wait = slot.last_call + slot.seconds_between - time.monotonic()
            if wait > 0:
                self.sleep(wait)
            slot.last_call = time.monotonic()
            body = {
                "model": slot.model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "temperature": 0.2,
                "max_tokens": max_tokens,
                **slot.extra,
            }
            if slot.json_mode:
                body["response_format"] = {"type": "json_object"}
            try:
                resp = self.http.post(
                    slot.base_url + "chat/completions",
                    headers={"Authorization": f"Bearer {slot.api_key}"},
                    json=body,
                    timeout=min(REQUEST_TIMEOUT, max(5.0, deadline - time.monotonic())) if deadline else REQUEST_TIMEOUT,
                )
            except requests.Timeout:
                # Too slow: skip this model for the rest of the run and try the next one.
                self.errors[slot.key] = f"no answer within {REQUEST_TIMEOUT:.0f}s"
                log.warning("AI model %s too slow, trying the next model", slot.key)
                self._usage(slot).requests += 1
                self.s.commit()
                return None
            except requests.RequestException as e:
                log.warning("AI request to %s failed: %s", slot.key, e)
                self.sleep(5)
                continue

            usage = self._usage(slot)
            usage.requests += 1
            if resp.status_code == 200:
                try:
                    payload = resp.json()
                    usage.tokens += int((payload.get("usage") or {}).get("total_tokens") or 0)
                    self.s.commit()
                    content = payload["choices"][0]["message"].get("content") or ""
                    return parse_json(content)
                except (ValueError, KeyError, IndexError, TypeError) as e:
                    self.s.commit()
                    bad_json += 1
                    log.warning("AI %s returned unreadable output (%s)", slot.key, e)
                    if bad_json >= 2:
                        return None
                    continue
            self.s.commit()

            text = resp.text[:2000]
            low = text.lower()
            if resp.status_code == 400 and slot.json_mode and ("response_format" in low or "json" in low):
                slot.json_mode = False  # this model does not support JSON mode; ask in the prompt only
                continue
            if resp.status_code == 400 and "reasoning" in low and slot.extra:
                slot.extra = {}
                continue
            if resp.status_code == 429:
                # Gemini names the metric (…PerDay… vs …PerMinute…); Groq says "(RPD)"/"(TPD)".
                compact = low.replace(" ", "").replace("_", "")
                if any(w in compact for w in ("perday", "daily", "(rpd)", "(tpd)")):
                    self._mark_exhausted(slot, f"free daily limit reached: {_short(text)}")
                    return None
                retry_after = _retry_after(resp)
                if deadline is not None and time.monotonic() + retry_after > deadline:
                    return None
                log.info("AI %s rate limited, waiting %.0fs", slot.key, retry_after)
                self.sleep(retry_after)
                continue
            if resp.status_code in (401, 403) or (
                    resp.status_code == 400 and ("api key" in low or "api_key" in low)):
                # Bad key: skip for this run only, so a fixed key works on the next run.
                self.errors[slot.key] = f"API key rejected ({resp.status_code}): {_short(text)}"
                log.warning("AI model %s: %s", slot.key, self.errors[slot.key])
                return None
            if resp.status_code == 404 or (resp.status_code == 400 and "model" in low):
                self._mark_exhausted(slot, f"model not available ({resp.status_code}): {_short(text)}")
                return None
            if resp.status_code >= 500:
                self.sleep(5 * (attempt + 1))
                continue
            log.warning("AI %s error %s: %s", slot.key, resp.status_code, text[:300])
            return None
        return None


def _short(text: str) -> str:
    """One-line error message from a JSON error body."""
    try:
        data = json.loads(text)
        if isinstance(data, list) and data:
            data = data[0]
        msg = data.get("error", {}).get("message")
        if msg:
            return " ".join(str(msg).split())[:300]
    except (ValueError, AttributeError):
        pass
    return " ".join(text.split())[:300]


def _retry_after(resp: requests.Response) -> float:
    value = resp.headers.get("retry-after")
    try:
        if value:
            return min(90.0, max(1.0, float(value)))
    except ValueError:
        pass
    m = re.search(r"retry in ([\d.]+)\s*s", resp.text, re.I)
    if m:
        return min(90.0, float(m.group(1)) + 1)
    return 20.0


def parse_json(content: str) -> dict:
    """Parse model output that should be JSON, tolerating ```json fences and chatter."""
    text = content.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("no JSON object in output")
        data = json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("expected a JSON object")
    return data


def check_models(session: Session, slots: list[ModelSlot]) -> list[tuple[str, str]]:
    """Send a tiny test prompt to every configured model. Returns (model, status) rows."""
    results = []
    for slot in slots:
        router = LLMRouter(session, [slot])
        try:
            data, _ = router.chat_json(
                "Reply with JSON only.",
                'Classify the sentiment of "semma video bro, romba nalla iruku". '
                'Return {"sentiment": "positive|neutral|negative", "language": "..."}',
                max_tokens=300,
            )
            results.append((slot.key, f"OK → {json.dumps(data, ensure_ascii=False)}"))
        except NoModelAvailable:
            row = session.get(LlmUsage, (quota_day(), slot.key))
            reason = router.errors.get(slot.key) or (row.last_error if row else None) or "no usable response"
            results.append((slot.key, f"NOT AVAILABLE: {reason[:200]}"))
    return results
