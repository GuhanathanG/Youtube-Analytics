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
    # Mistral's free "Experiment" plan: about 1 request/second and ~1B tokens/month (phone verification only).
    # Several models, because the free tier can report "capacity exceeded" for one model while others answer.
    "mistral": ("https://api.mistral.ai/v1/", "MISTRAL", "mistral-small-latest,ministral-8b-latest,open-mistral-nemo",
                20000, 1.5),
    # Cloudflare Workers AI: 10,000 free "neurons" a day (~40 big batches with gpt-oss-20b).
    # Needs CLOUDFLARE_ACCOUNT_ID as well as CLOUDFLARE_API_KEY.
    "cloudflare": ("https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/", "CLOUDFLARE",
                   "@cf/openai/gpt-oss-20b", 40, 2.0),
    # OpenRouter's ":free" models: 50 requests/day per account (shared by all its free models).
    "openrouter": ("https://openrouter.ai/api/v1/", "OPENROUTER",
                   "google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,nvidia/nemotron-3.5-lightning:free", 50, 4.0),
    # GitHub Models: free for every GitHub account. In GitHub Actions the job's own token works
    # (permission "models: read"), so no extra key is needed. Low daily limits per model.
    "github": ("https://models.github.ai/inference/", "GITHUB_MODELS",
               "openai/gpt-4.1-mini,openai/gpt-4.1-nano,mistral-ai/mistral-small-2503", 50, 4.0),
    # SambaNova Cloud free tier (no card): needs SAMBANOVA_API_KEY.
    "sambanova": ("https://api.sambanova.ai/v1/", "SAMBANOVA", "Meta-Llama-3.3-70B-Instruct,Meta-Llama-3.1-8B-Instruct", 400, 3.0),
    # NVIDIA NIM (free with the NVIDIA Developer Program, ~40 requests/minute): needs NVIDIA_API_KEY.
    "nvidia": ("https://integrate.api.nvidia.com/v1/", "NVIDIA", "meta/llama-3.3-70b-instruct,openai/gpt-oss-20b", 500, 2.0),
    # E8: a small open model served by llama.cpp (OpenAI-compatible) on a machine you run, opt-in with
    # LOCAL_LLM_API_KEY (any value) and LOCAL_LLM_BASE_URL. Measured on a 4-core CPU: Qwen2.5-1.5B labels ~5
    # comments a minute with weak Tanglish quality, so it is NOT run on GitHub Actions; the worker's local mood,
    # emotion and question models already cover the "cloud AI used up" case. Worth it on a GPU or a fast box.
    "local": ("http://127.0.0.1:8080/v1/", "LOCAL_LLM", "local", 100000, 0.0),
}

DEFAULT_ORDER = "gemini,mistral,groq,cloudflare,github,sambanova,nvidia,openrouter,local"


def split_keys(raw: str) -> list[str]:
    """One key, or several separated by commas or new lines (e.g. a teammate's own free key).
    Only use keys you're allowed to use: most providers forbid opening extra accounts to get more."""
    return [k.strip() for k in raw.replace("\n", ",").split(",") if k.strip()]


def discover_gemini_models(api_key: str, http: requests.Session | None = None) -> list[str]:
    """Ask Google which text models this key can use, instead of guessing names that may have
    been retired. Flash-Lite first (most free requests), then Flash. Empty list on any error."""
    try:
        resp = (http or requests).get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": api_key, "pageSize": 200}, timeout=15)
        if resp.status_code != 200:
            return []
        models = resp.json().get("models") or []
    except (requests.RequestException, ValueError):
        return []
    return pick_gemini_models(models)


_SKIP = ("image", "tts", "audio", "live", "embedding", "vision", "thinking", "robotics", "computer-use", "omni")


def pick_gemini_models(models: list[dict]) -> list[str]:
    names = []
    for m in models:
        name = str(m.get("name", "")).removeprefix("models/")
        methods = m.get("supportedGenerationMethods") or []
        if "generateContent" not in methods or not name.startswith("gemini-") or "flash" not in name:
            continue
        if any(w in name for w in _SKIP):
            continue
        names.append(name)

    def rank(n: str):
        version = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
        return (0 if "lite" in n else 1, "preview" in n or "exp" in n, -float(version.group(1)) if version else 0, n)
    return sorted(set(names), key=rank)[:5]


def reasoning_for(provider: str, model: str) -> str:
    """Least 'thinking' each model allows: thinking makes answers slow, and labelling
    comments doesn't need it. Gemini 2.5 can switch it off; Gemini 3 only down to minimal."""
    if provider == "gemini":
        return "none" if model.startswith("gemini-2.5") else "minimal"
    if provider.split("#")[0] in ("openrouter", "mistral", "cloudflare", "github", "sambanova", "nvidia", "local"):
        return ""  # not part of these APIs; don't send the parameter
    return "low"


REQUEST_TIMEOUT = float(os.environ.get("AI_REQUEST_TIMEOUT", "45"))


def slots_from_env(env: dict | None = None, discover: bool = False) -> list[ModelSlot]:
    """Build the ordered list of models from environment variables / secrets.

    GEMINI_API_KEY, GROQ_API_KEY            - enable a provider
    GEMINI_MODELS, GROQ_MODELS              - comma-separated, tried in order
    GEMINI_DAILY_REQUESTS, GROQ_DAILY_REQUESTS
    GEMINI_SECONDS_BETWEEN, GROQ_SECONDS_BETWEEN
    MISTRAL_API_KEY, CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID, OPENROUTER_API_KEY,
    GITHUB_MODELS_API_KEY (in Actions: the job's GITHUB_TOKEN), SAMBANOVA_API_KEY, NVIDIA_API_KEY
    Any *_API_KEY may hold several keys separated by commas (each gets its own daily allowance).
    AI_PROVIDER_ORDER                       - default DEFAULT_ORDER
    discover=True asks Google which Gemini models the key can use (when GEMINI_MODELS isn't set).
    """
    env = env if env is not None else os.environ
    order = [p.strip() for p in env.get("AI_PROVIDER_ORDER", DEFAULT_ORDER).split(",") if p.strip()]
    slots: list[ModelSlot] = []
    for name in order:
        if name not in PROVIDERS:
            continue
        base_url, prefix, models, daily, gap = PROVIDERS[name]
        base_url = env.get(f"{prefix}_BASE_URL", base_url)
        keys = split_keys(env.get(f"{prefix}_API_KEY", ""))
        if not keys:
            continue
        if "{account}" in base_url:
            account = env.get(f"{prefix}_ACCOUNT_ID", "").strip()
            if not account:
                continue
            base_url = base_url.replace("{account}", account)
        if name == "gemini" and not env.get("GEMINI_MODELS") and discover:
            models = ",".join(discover_gemini_models(keys[0])) or models
        for i, key in enumerate(keys):
            label = name if i == 0 else f"{name}#{i + 1}"  # each key has its own daily allowance
            for model in [m.strip() for m in env.get(f"{prefix}_MODELS", models).split(",") if m.strip()]:
                effort = reasoning_for(name, model)
                extra = {"reasoning_effort": effort} if effort else {}
                slots.append(ModelSlot(
                    provider=label,
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
        self.errors_seen: dict[str, str] = {}  # last temporary problem per model, for messages

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
                self.errors_seen[slot.key] = f"rate limited (429): {_short(text)}"
                if attempt == 3 or (deadline is not None and time.monotonic() + retry_after > deadline):
                    # Still busy: skip it for this run and say why (e.g. "service tier capacity exceeded").
                    self.errors[slot.key] = self.errors_seen[slot.key]
                    log.warning("AI model %s: %s", slot.key, self.errors[slot.key])
                    return None
                log.info("AI %s rate limited (%s), waiting %.0fs", slot.key, _short(text)[:120], retry_after)
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
            reason = (router.errors.get(slot.key) or (row.last_error if row and row.exhausted else None)
                      or router.errors_seen.get(slot.key) or "no usable response")
            results.append((slot.key, f"NOT AVAILABLE: {reason[:200]}"))
    return results
