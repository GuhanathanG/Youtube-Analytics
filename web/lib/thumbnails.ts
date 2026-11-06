import "server-only";
import { sql } from "./db";
import { geminiModelList } from "./ai";
import { quotaDay } from "./queries";

/**
 * 3. Thumbnail analysis. Gemini looks at each thumbnail (one small image, ~260 tokens) and
 * describes faces, text, colours and style. The Analytics page then compares these features
 * with each video's outlier score ("thumbnails with a face get 2.1× views").
 */
const PROMPT = `You are a YouTube thumbnail analyst. Look at this thumbnail and reply with JSON only:
{
 "faces": number of human faces clearly visible (0 if none),
 "face_emotion": "none" | "happy" | "surprised" | "shocked" | "serious" | "angry" | "sad" | "neutral",
 "text": "the words written on the thumbnail, exactly ('' if none)",
 "text_words": number of words written on it,
 "text_language": "language of the written text, or ''",
 "main_colors": ["2-3 dominant colours, simple names"],
 "brightness": "dark" | "medium" | "bright",
 "contrast": "low" | "medium" | "high",
 "subject": "what the thumbnail shows, max 10 words",
 "elements": ["notable elements: arrow, circle, product, logo, before/after, emoji, number, ..."],
 "style": "short phrase, e.g. 'close-up reaction with big yellow text'",
 "readability": "good" | "ok" | "poor" (is the text readable on a phone?),
 "clickbait": 0-10 (how sensational it looks)
}`;

let ready = false;
async function ensureTable() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists thumb_analysis (
    video_id text primary key, status text not null, model text, data text, error text,
    created_at timestamp not null default (now() at time zone 'utc'))`;
  await db`alter table thumb_analysis enable row level security`;
  ready = true;
}

export type ThumbData = {
  faces?: number; face_emotion?: string; text?: string; text_words?: number; text_language?: string;
  main_colors?: string[]; brightness?: string; contrast?: string; subject?: string; elements?: string[];
  style?: string; readability?: string; clickbait?: number;
};

function bestThumb(url: string): string {
  // Ask for the larger "hqdefault"/"maxres" version when the stored one is small.
  return url.replace(/\/(default|mqdefault)\.jpg/, "/hqdefault.jpg");
}

export async function analyseThumbnail(videoId: string, url: string): Promise<boolean> {
  await ensureTable();
  const db = sql();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return false;
  let image: Buffer;
  let mime = "image/jpeg";
  try {
    const res = await fetch(bestThumb(url), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`image ${res.status}`);
    mime = res.headers.get("content-type")?.split(";")[0] ?? mime;
    image = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    await db`insert into thumb_analysis (video_id, status, error) values (${videoId}, 'error', ${String(e).slice(0, 300)})
      on conflict (video_id) do update set status = 'error', error = excluded.error, created_at = (now() at time zone 'utc')`;
    return false;
  }
  const base = process.env.GEMINI_NATIVE_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
  for (const model of (await geminiModelList()).slice(0, 4)) {
    try {
      const res = await fetch(`${base}/models/${model}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: image.toString("base64") } }, { text: PROMPT }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 800,
            ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const payload = await res.json();
      const raw = payload.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      const data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")) as ThumbData;
      await db`insert into thumb_analysis (video_id, status, model, data, created_at) values (${videoId}, 'done', ${model}, ${JSON.stringify(data)}, (now() at time zone 'utc'))
        on conflict (video_id) do update set status = 'done', model = excluded.model, data = excluded.data, error = null, created_at = excluded.created_at`;
      await db`insert into llm_usage (day, model_key, requests, tokens, exhausted) values (${quotaDay()}, ${"gemini/" + model}, 1, ${Number(payload.usageMetadata?.totalTokenCount ?? 0)}, false)
        on conflict (day, model_key) do update set requests = llm_usage.requests + 1, tokens = llm_usage.tokens + excluded.tokens`;
      return true;
    } catch { /* try the next model */ }
  }
  await db`insert into thumb_analysis (video_id, status, error) values (${videoId}, 'error', 'no model answered')
    on conflict (video_id) do update set status = 'error', error = excluded.error, created_at = (now() at time zone 'utc')`;
  return false;
}

/** Analyse thumbnails not done yet (newest videos first; failed ones retried after a day). */
export async function analyseDueThumbnails(max = 25, deadline = Date.now() + 120_000): Promise<number> {
  if (!process.env.GEMINI_API_KEY) return 0;
  await ensureTable();
  const due = await sql()`
    select v.id, v.thumbnail_url from videos v join channels c on c.id = v.channel_id
    left join thumb_analysis t on t.video_id = v.id
    where c.active and v.thumbnail_url is not null
      and (t.video_id is null or (t.status = 'error' and t.created_at < (now() at time zone 'utc') - interval '1 day'))
    order by v.published_at desc nulls last limit ${max}`;
  let done = 0;
  for (const v of due) {
    if (Date.now() > deadline) break;
    if (await analyseThumbnail(v.id as string, v.thumbnail_url as string)) done++;
  }
  return done;
}

export async function thumbnailsFor(channelId: string): Promise<Map<string, ThumbData>> {
  try {
    const rows = await sql()`select t.video_id, t.data from thumb_analysis t join videos v on v.id = t.video_id
      where v.channel_id = ${channelId} and t.status = 'done'`;
    const out = new Map<string, ThumbData>();
    for (const r of rows) { try { out.set(r.video_id as string, JSON.parse(r.data as string)); } catch { /* skip */ } }
    return out;
  } catch {
    return new Map(); // table not created yet
  }
}
