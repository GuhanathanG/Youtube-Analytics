import "server-only";
import { sql } from "./db";
import { quotaDay } from "./queries";

/**
 * Free AI (Gemini first, then Groq) for the website's live mode. Mirrors the Python
 * worker: same models, same prompt, same per-model daily usage table (`llm_usage`).
 */
type Slot = { provider: string; baseUrl: string; key: string; model: string; daily: number };

const PROVIDERS: Record<string, { base: string; prefix: string; models: string; daily: number }> = {
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai/", prefix: "GEMINI",
    models: "gemini-2.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash-lite,gemini-3.8-flash", daily: 200 },
  groq: { base: "https://api.groq.com/openai/v1/", prefix: "GROQ", models: "openai/gpt-oss-20b,openai/gpt-oss-120b", daily: 900 },
};

export function aiSlots(): Slot[] {
  const env = process.env;
  const order = (env.AI_PROVIDER_ORDER ?? "gemini,groq").split(",").map((s) => s.trim());
  const slots: Slot[] = [];
  for (const name of order) {
    const p = PROVIDERS[name];
    const key = p && env[`${p.prefix}_API_KEY`]?.trim();
    if (!p || !key) continue;
    for (const model of (env[`${p.prefix}_MODELS`] ?? p.models).split(",").map((m) => m.trim()).filter(Boolean)) {
      slots.push({ provider: name, baseUrl: env[`${p.prefix}_BASE_URL`] ?? p.base, key, model, daily: Number(env[`${p.prefix}_DAILY_REQUESTS`] ?? p.daily) });
    }
  }
  return slots;
}

const keyOf = (s: Slot) => `${s.provider}/${s.model}`;

async function usable(s: Slot): Promise<boolean> {
  const [r] = await sql()`select requests, exhausted from llm_usage where day = ${quotaDay()} and model_key = ${keyOf(s)}`;
  return !r || (!r.exhausted && (r.requests as number) < s.daily);
}

async function record(s: Slot, tokens: number, exhausted = false, error: string | null = null) {
  await sql()`
    insert into llm_usage (day, model_key, requests, tokens, exhausted, last_error)
    values (${quotaDay()}, ${keyOf(s)}, 1, ${tokens}, ${exhausted}, ${error})
    on conflict (day, model_key) do update set
      requests = llm_usage.requests + 1, tokens = llm_usage.tokens + excluded.tokens,
      exhausted = llm_usage.exhausted or excluded.exhausted,
      last_error = coalesce(excluded.last_error, llm_usage.last_error)`;
}

export function parseJson(content: string): Record<string, unknown> {
  let text = content.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  try { return JSON.parse(text); } catch { /* try the outermost object */ }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in AI output");
  return JSON.parse(text.slice(a, b + 1));
}

/** Least "thinking" each model allows: thinking makes answers slow and labelling doesn't need it. */
function reasoningFor(s: Slot): string {
  if (s.provider === "gemini") return s.model.startsWith("gemini-2.5") ? "none" : "minimal";
  return "low";
}

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT ?? 30) * 1000;
// Models that timed out recently are skipped for a while (per server instance).
const slowUntil = new Map<string, number>();

/** Ask the first available free model for JSON. Returns null when none can answer right now. */
export async function chatJson(system: string, user: string, maxTokens = 4000, deadline?: number): Promise<{ data: Record<string, unknown>; model: string } | null> {
  for (const s of aiSlots()) {
    if ((slowUntil.get(keyOf(s)) ?? 0) > Date.now()) continue;
    if (deadline && Date.now() > deadline - 5000) return null;
    if (!(await usable(s))) continue;
    let jsonMode = true;
    let reasoning: string | null = reasoningFor(s);
    for (let attempt = 0; attempt < 3; attempt++) {
      const body: Record<string, unknown> = {
        model: s.model, temperature: 0.2, max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      };
      if (reasoning) body.reasoning_effort = reasoning;
      if (jsonMode) body.response_format = { type: "json_object" };
      const timeout = deadline ? Math.max(5000, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())) : REQUEST_TIMEOUT_MS;
      let res: Response;
      try {
        res = await fetch(s.baseUrl + "chat/completions", {
          method: "POST", headers: { Authorization: `Bearer ${s.key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
        });
      } catch {
        slowUntil.set(keyOf(s), Date.now() + 10 * 60000); // too slow: skip it for 10 minutes
        await record(s, 0, false, "no answer in time");
        break;
      }
      const text = await res.text();
      const low = text.toLowerCase();
      if (res.ok) {
        try {
          const payload = JSON.parse(text);
          await record(s, Number(payload?.usage?.total_tokens ?? 0));
          return { data: parseJson(payload.choices?.[0]?.message?.content ?? ""), model: keyOf(s) };
        } catch { await record(s, 0); break; }
      }
      if (res.status === 400 && jsonMode && low.includes("response_format")) { jsonMode = false; continue; }
      if (res.status === 400 && reasoning && low.includes("reasoning")) { reasoning = null; continue; }
      const compact = low.replace(/[\s_]/g, "");
      if (res.status === 429 && /perday|daily|\(rpd\)|\(tpd\)/.test(compact)) { await record(s, 0, true, "free daily limit reached"); break; }
      if (res.status === 404 || (res.status === 400 && low.includes("model"))) { await record(s, 0, true, "model not available"); break; }
      break; // per-minute limit, bad key or other error: try the next model
    }
  }
  return null;
}

/* ------------------------------------------------------------------ comment labelling */
const EMOTIONS = ["joy", "love", "gratitude", "admiration", "excitement", "humor", "surprise", "curiosity", "neutral",
  "confusion", "disappointment", "sadness", "anger", "disgust", "fear", "sarcasm"];
const ASPECTS = ["content", "host", "editing", "audio", "video_quality", "thumbnail_title", "length_pacing", "music",
  "ads_sponsor", "information", "humor", "guest", "other"];

const SYSTEM = `You analyze YouTube comments for a creator-analytics dashboard.
Comments can be in any language, in native script or romanized, and often code-mixed
(e.g. Tanglish = Tamil in English letters: "semma", "vera level", "mokka" = boring;
Hinglish = Hindi in English letters). Read slang, emoji and sarcasm the way a native speaker would.

For EVERY comment return one object:
- "i": the comment number given
- "sentiment": "positive" | "neutral" | "negative" (toward the video/creator/topic; sarcasm counts as what is really meant)
- "score": number from -1 (very negative) to 1 (very positive)
- "emotion": one of ${EMOTIONS.join(", ")}
- "question": true if the comment asks something
- "suggestion": true if it requests or suggests content/changes ("make part 2", "please review X")
- "spam": true for spam, scams, self-promotion, bots
- "toxic": true for insults, hate or harassment
- "aspects": list of {"a": aspect, "s": "pos"|"neg"|"neu"} for what the comment talks about;
  aspect is one of ${ASPECTS.join(", ")}; empty list if none
- "lang": language code (en, ta, hi, te, ml, kn, ...; add "-Latn" for romanized, e.g. "ta-Latn"; "und" if unclear)
- "en": short English translation if the comment is not English, else ""

Reply with JSON only: {"results": [ ... ]}`;

/** AI-label the given comments (newest first). Returns how many were labelled. */
export async function labelComments(ids: string[], deadline?: number): Promise<number> {
  if (!ids.length || !aiSlots().length) return 0;
  const db = sql();
  let done = 0;
  for (let i = 0; i < ids.length; i += 25) {
    if (deadline && Date.now() > deadline - 8000) break;
    const rows = await db`
      select c.id, c.text, v.title from comments c join videos v on v.id = c.video_id
      where c.id in ${db(ids.slice(i, i + 25))} and c.ai_at is null`;
    if (!rows.length) continue;
    const titles = [...new Set(rows.map((r) => r.title as string))];
    const prompt = ["Videos:", ...titles.map((t, n) => `V${n + 1}: ${t}`), "", "Comments:",
      ...rows.map((r, n) => `${n + 1}. [V${titles.indexOf(r.title as string) + 1}] ${String(r.text ?? "").split(/\s+/).join(" ").slice(0, 500)}`)].join("\n");
    const out = await chatJson(SYSTEM, prompt, 4000, deadline);
    if (!out) break; // no model available right now; the background job will catch up
    const results = new Map<number, Record<string, unknown>>();
    for (const item of (out.data.results as Record<string, unknown>[] | undefined) ?? []) {
      const n = Number(item?.i);
      if (Number.isInteger(n)) results.set(n, item);
    }
    for (const [n, r] of rows.entries()) {
      const item = results.get(n + 1);
      if (!item) continue;
      const sentiment = ["positive", "neutral", "negative"].includes(String(item.sentiment)) ? String(item.sentiment) : null;
      let score = Number(item.score);
      if (!Number.isFinite(score)) score = sentiment === "positive" ? 0.7 : sentiment === "negative" ? -0.7 : 0;
      score = Math.max(-1, Math.min(1, score));
      const emotion = EMOTIONS.includes(String(item.emotion)) ? String(item.emotion) : null;
      const aspects = [...new Set(((item.aspects as { a?: string; s?: string }[]) ?? [])
        .map((a) => [String(a?.a ?? "").toLowerCase().replace(/ /g, "_"), String(a?.s ?? "neu").slice(0, 3)] as const)
        .filter(([a, s]) => ASPECTS.includes(a) && ["pos", "neg", "neu"].includes(s)).map(([a, s]) => `${a}:${s}`))].join(",").slice(0, 300) || null;
      const lang = String(item.lang ?? "");
      const en = String(item.en ?? "").trim().slice(0, 2000) || null;
      const now = new Date().toISOString().slice(0, 19);
      await db`
        update comments set
          emotion = ${emotion}, is_question = ${!!item.question}, is_suggestion = ${!!item.suggestion},
          is_spam = ${!!item.spam}, is_toxic = ${!!item.toxic}, aspects = ${aspects}, translation = ${en},
          ai_at = ${now}, ai_model = ${out.model.slice(0, 100)}
          ${sentiment ? db`, sentiment = ${sentiment}, sentiment_value = ${Math.round(score * 1e4) / 1e4},
              sentiment_score = ${Math.round((sentiment === "neutral" ? 1 - Math.abs(score) : Math.abs(score)) * 1e4) / 1e4},
              sentiment_source = 'ai', analyzed_at = ${now}, analyzer = ${out.model.slice(0, 200)}` : db``}
          ${/^[A-Za-z]{2,3}(-[A-Za-z]{4})?$/.test(lang) || lang === "und" ? db`, language = ${lang}` : db``}
        where id = ${r.id as string}`;
      done++;
    }
  }
  return done;
}


/** The backlog: comments the AI hasn't read yet. Tanglish/Hinglish, unknown language and
 *  comments the local model was unsure about go first, then the newest. */
export async function labelBacklog(deadline: number, maxComments = 100): Promise<number> {
  if (!aiSlots().length) return 0;
  const rows = await sql()`
    select id from comments where ai_at is null and length(text) > 0
    order by (case when language like '%-Latn' or language = 'und' or sentiment_score is null or sentiment_score < 0.6 then 0 else 1 end),
             published_at desc nulls last
    limit ${maxComments}`;
  return labelComments(rows.map((r) => r.id as string), deadline);
}
