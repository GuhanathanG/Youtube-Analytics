import "server-only";
import { sql } from "./db";
import { quotaDay } from "./queries";
import { quickLabel } from "./quick-labels";
import { pickGeminiModels } from "./gemini-models";

/**
 * Free AI (Gemini first, then Groq) for the website's live mode. Mirrors the Python
 * worker: same models, same prompt, same per-model daily usage table (`llm_usage`).
 */
type Slot = { provider: string; baseUrl: string; key: string; model: string; daily: number };

const PROVIDERS: Record<string, { base: string; prefix: string; models: string; daily: number }> = {
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai/", prefix: "GEMINI",
    models: "gemini-2.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash-lite,gemini-3.8-flash", daily: 200 },
  groq: { base: "https://api.groq.com/openai/v1/", prefix: "GROQ", models: "openai/gpt-oss-20b,openai/gpt-oss-120b", daily: 900 },
  // Mistral free "Experiment" plan: ~1 request/second, ~1B tokens/month (phone verification only).
  mistral: { base: "https://api.mistral.ai/v1/", prefix: "MISTRAL", models: "mistral-small-latest,ministral-8b-latest,open-mistral-nemo", daily: 20000 },
  // Cloudflare Workers AI: 10,000 free "neurons"/day. Needs CLOUDFLARE_ACCOUNT_ID too.
  cloudflare: { base: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/", prefix: "CLOUDFLARE",
    models: "@cf/openai/gpt-oss-20b", daily: 40 },
  // OpenRouter ":free" models: 50 requests/day per account, shared across its free models.
  openrouter: { base: "https://openrouter.ai/api/v1/", prefix: "OPENROUTER",
    models: "google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,nvidia/nemotron-3.5-lightning:free", daily: 50 },
};

// Gemini model names change; ask Google which ones this key can use (cached for 6 hours).
let geminiFound: { at: number; models: string[] } | null = null;
async function discoverGemini() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || process.env.GEMINI_MODELS || (geminiFound && Date.now() - geminiFound.at < 6 * 3600_000)) return;
  try {
    const base = process.env.GEMINI_NATIVE_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
    const res = await fetch(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(8000) });
    const models = res.ok ? pickGeminiModels(((await res.json()).models ?? []) as never[]) : [];
    geminiFound = { at: Date.now(), models };
  } catch {
    geminiFound = { at: Date.now() - 5 * 3600_000, models: [] }; // try again in an hour
  }
}

/** Gemini text models this key can use (discovered, else the configured/default list). */
export async function geminiModelList(): Promise<string[]> {
  await discoverGemini();
  if (process.env.GEMINI_MODELS) return process.env.GEMINI_MODELS.split(",").map((m) => m.trim()).filter(Boolean);
  return geminiFound?.models.length ? geminiFound.models : PROVIDERS.gemini.models.split(",");
}

export function aiSlots(): Slot[] {
  const env = process.env;
  const order = (env.AI_PROVIDER_ORDER ?? "gemini,mistral,groq,cloudflare,openrouter").split(",").map((s) => s.trim());
  const slots: Slot[] = [];
  for (const name of order) {
    const p = PROVIDERS[name];
    const key = p && env[`${p.prefix}_API_KEY`]?.trim();
    if (!p || !key) continue;
    let base = env[`${p.prefix}_BASE_URL`] ?? p.base;
    if (base.includes("{account}")) {
      const account = env[`${p.prefix}_ACCOUNT_ID`]?.trim();
      if (!account) continue;
      base = base.replace("{account}", encodeURIComponent(account));
    }
    const found = name === "gemini" && !env.GEMINI_MODELS && geminiFound?.models.length ? geminiFound.models.join(",") : null;
    for (const model of (found ?? env[`${p.prefix}_MODELS`] ?? p.models).split(",").map((m) => m.trim()).filter(Boolean)) {
      slots.push({ provider: name, baseUrl: base, key, model, daily: Number(env[`${p.prefix}_DAILY_REQUESTS`] ?? p.daily) });
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
function reasoningFor(s: Slot): string | null {
  if (s.provider === "gemini") return s.model.startsWith("gemini-2.5") ? "none" : "minimal";
  if (["openrouter", "mistral", "cloudflare"].includes(s.provider)) return null; // not part of these APIs
  return "low";
}

const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT ?? 30) * 1000;
// Models that timed out recently are skipped for a while (per server instance).
const slowUntil = new Map<string, number>();

/** Ask the first available free model for JSON. Returns null when none can answer right now. */
export async function chatJson(system: string, user: string, maxTokens = 4000, deadline?: number, startAt = 0): Promise<{ data: Record<string, unknown>; model: string } | null> {
  await discoverGemini();
  const all = aiSlots();
  // Parallel callers start at different models so they don't all queue on the first one.
  const ordered = [...all.slice(startAt % Math.max(1, all.length)), ...all.slice(0, startAt % Math.max(1, all.length))];
  for (const s of ordered) {
    if ((slowUntil.get(keyOf(s)) ?? 0) > Date.now()) continue;
    if (deadline && Date.now() > deadline - 5000) return null;
    if (!(await usable(s))) continue;
    let jsonMode = true;
    let reasoning = reasoningFor(s);
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
        // Only a model that had its full time is "too slow". If our own run was nearly over, it wasn't its fault.
        if (timeout >= REQUEST_TIMEOUT_MS) {
          slowUntil.set(keyOf(s), Date.now() + 10 * 60000); // skip it for 10 minutes
          await record(s, 0, false, "no answer in time");
        }
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

/** Rule-label short reactions ("first!", "❤️🔥", "semma bro") so free AI requests go to comments
 *  that need reading. Returns the ids that still need the AI. */
export async function labelTrivial(ids: string[]): Promise<string[]> {
  if (!ids.length) return ids;
  const db = sql();
  const rows = await db`select id, text from comments where id in ${db(ids)} and ai_at is null and length(text) <= 60`;
  const hits = rows.map((r) => ({ id: r.id as string, q: quickLabel(r.text as string) })).filter((h) => h.q);
  if (hits.length) {
    const now = new Date().toISOString().slice(0, 19);
    // One statement for all of them (each round trip to the database costs time).
    await db`
      update comments c set emotion = v.emotion, is_question = false, is_suggestion = false, is_spam = false,
        is_toxic = false, aspects = null, ai_at = ${now}::timestamp, ai_model = 'rules',
        sentiment = v.sentiment, sentiment_value = v.score, sentiment_score = v.conf,
        sentiment_source = 'rules', analyzed_at = ${now}::timestamp, analyzer = 'rules',
        language = coalesce(v.lang, c.language)
      from unnest(${hits.map((h) => h.id)}::text[], ${hits.map((h) => h.q!.emotion)}::text[],
                  ${hits.map((h) => h.q!.sentiment)}::text[], ${hits.map((h) => h.q!.score)}::float8[],
                  ${hits.map((h) => (h.q!.sentiment === "neutral" ? 1 : Math.abs(h.q!.score)))}::float8[],
                  ${hits.map((h) => h.q!.lang)}::text[]) as v(id, emotion, sentiment, score, conf, lang)
      where c.id = v.id and c.ai_at is null`;
  }
  const done = new Set(hits.map((h) => h.id));
  return ids.filter((id) => !done.has(id));
}

// The website engine runs in short slots (~22 s), so its batches are small enough to finish in one;
// the background job uses big batches (AI_BATCH_SIZE, 100).
const BATCH = () => Math.max(5, Math.min(100, Number(process.env.AI_BATCH ?? 20)));

/** AI-label the given comments. Short reactions are rule-labelled first; the rest go out in batches
 *  of AI_BATCH (default 50) in parallel (up to AI_PARALLEL at once), each starting at a different model. */
export async function labelComments(ids: string[], deadline?: number): Promise<number> {
  if (!ids.length) return 0;
  const rest = await labelTrivial(ids);
  const ruled = ids.length - rest.length;
  ids = rest;
  if (!ids.length || !aiSlots().length) return ruled;
  const chunks: string[][] = [];
  const size = BATCH();
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  const parallel = Math.max(1, Number(process.env.AI_PARALLEL ?? 3));
  let done = 0, next = 0, stop = false;
  async function worker(w: number) {
    if (w) await new Promise((r) => setTimeout(r, w * 1100)); // free plans allow ~1 new request a second
    while (!stop && next < chunks.length) {
      if (deadline && Date.now() > deadline - 8000) return;
      const chunk = chunks[next++];
      const n = await labelChunk(chunk, deadline, w);
      if (n < 0) { stop = true; return; } // no model available right now
      done += n;
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, chunks.length) }, (_, w) => worker(w)));
  return done + ruled;
}

async function labelChunk(chunkIds: string[], deadline: number | undefined, startAt: number): Promise<number> {
  const db = sql();
  let done = 0;
  {
    const rows = await db`
      select c.id, c.text, v.title from comments c join videos v on v.id = c.video_id
      where c.id in ${db(chunkIds)} and c.ai_at is null`;
    if (!rows.length) return 0;
    const rank = new Map(chunkIds.map((id, n) => [id, n]));
    rows.sort((a, b) => rank.get(a.id as string)! - rank.get(b.id as string)!);
    const titles = [...new Set(rows.map((r) => r.title as string))];
    const prompt = ["Videos:", ...titles.map((t, n) => `V${n + 1}: ${t}`), "", "Comments:",
      ...rows.map((r, n) => `${n + 1}. [V${titles.indexOf(r.title as string) + 1}] ${String(r.text ?? "").split(/\s+/).join(" ").slice(0, 500)}`)].join("\n");
    // ~110 output tokens per comment (with translation), plus headroom.
    const out = await chatJson(SYSTEM, prompt, Math.min(16000, 1000 + 130 * rows.length), deadline, startAt);
    if (!out) return -1;
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

/** The backlog: comments the AI hasn't read yet, most important first: the last 2 days, then the
 *  most liked and longest, then Tanglish/Hinglish and ones the local model was unsure about. */
export async function labelBacklog(deadline: number, maxComments = 100): Promise<number> {
  const db = sql();
  // Short reactions never need the AI: clear them from the newest part of the backlog first.
  const short = await db`select id from comments where ai_at is null and length(text) <= 60
    order by published_at desc nulls last limit 3000`;
  let ruled = 0;
  for (let i = 0; i < short.length; i += 500) {
    const ids = short.slice(i, i + 500).map((r) => r.id as string);
    ruled += ids.length - (await labelTrivial(ids)).length;
  }
  if (!aiSlots().length) return ruled;
  // Look at the newest 5,000 unread comments (index ix_comments_ai_next) and read the most useful first:
  //   1. brand-new comments (last 2 days)          4. well-liked comments (more viewers agree)
  //   2. comments on new videos (last 7 days)      5. ones the quick model was unsure about (Tanglish…)
  //   3. likely questions and requests             6. longer comments (more to learn from)
  const rows = await db`
    select r.id from (
      select id, video_id, language, sentiment_score, published_at, like_count, length(text) as len,
             (text ~ '[?？]' or text ~* '\m(please|pls|plz|make|next video|part [0-9]|when|how|enna|eppo|eppadi|kab|kaise)\M') as ask
      from comments where ai_at is null order by published_at desc nulls last limit 5000) r
    left join videos v on v.id = r.video_id
    order by (r.published_at >= (now() at time zone 'utc') - interval '2 days') desc nulls last,
             (v.published_at >= (now() at time zone 'utc') - interval '7 days') desc nulls last,
             r.ask desc,
             least(r.like_count, 50) desc,
             (case when r.language like '%-Latn' or r.language = 'und' or r.sentiment_score is null or r.sentiment_score < 0.6 then 0 else 1 end),
             r.len desc, r.published_at desc nulls last
    limit ${maxComments}`;
  return ruled + await labelComments(rows.map((r) => r.id as string), deadline);
}
