import { geminiModelList, splitKeys } from "./ai";
import "server-only";
import { sql, ensureRls, ensureColumns } from "./db";
import { quotaDay } from "./queries";

/**
 * Advanced video analysis.
 *  - AI watches the video: Gemini can read public YouTube videos (pictures + sound) by URL.
 *    Free tier: up to 8 hours of YouTube video per day (a Google preview feature).
 *  - Most-discussed moments: timestamps viewers write in comments ("2:35 😂").
 *  - Performance: like rate, comment rate and views per day vs the channel's usual.
 *  - Dislikes: YouTube hides them; "Return YouTube Dislike" publishes a community estimate.
 * Shares, watch time and retention are only visible to the channel owner, so they can't be shown.
 */

let ready = false;
export async function ensureVideoTables() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists video_analysis (
    video_id text primary key, status text not null default 'pending', model text, duration_s integer,
    data text, error text, created_at timestamp not null default (now() at time zone 'utc'))`;
  await ensureRls("video_analysis");
  await ensureColumns("videos", [["tags", "text"], ["category_id", "text"], ["definition", "text"], ["has_captions", "boolean"],
    ["default_language", "text"], ["topic_categories", "text"], ["ryd_dislikes", "bigint"], ["ryd_fetched_at", "timestamp"], ["media_url", "text"]]);
  ready = true;
}

export const durationSeconds = (iso: string | null | undefined) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? "");
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

/* ================================================================== AI watches the video */
const VIDEO_PROMPT = `You are a YouTube content analyst. Watch this video (pictures and sound) and analyse it
for someone studying the creator. Viewers and creators may speak Tamil, Hindi, English or a mix.
Write everything in clear, simple English. Use timestamps as "m:ss" (or "h:mm:ss").
Reply with JSON only:
{
 "summary": "4-6 sentences: what the video is about and how it unfolds",
 "format": "e.g. review, vlog, tutorial, reaction, short, interview, live stream",
 "languages": ["spoken languages"],
 "tone": "short phrase (e.g. energetic and humorous)",
 "hook": {"first_30s": "what happens in the first 30 seconds", "strength": "strong|average|weak", "why": "one sentence"},
 "chapters": [{"start": "m:ss", "title": "short title", "summary": "one sentence"}],
 "key_moments": [{"time": "m:ss", "what": "what happens", "why": "why it matters to viewers"}],
 "topics": ["main topics"],
 "people_brands_products": ["people, brands or products shown or named"],
 "sponsor_segments": [{"start": "m:ss", "end": "m:ss", "brand": "name"}],
 "calls_to_action": ["e.g. subscribe ask at 0:45, link in description"],
 "production": {"editing": "one sentence", "audio": "one sentence", "visuals": "one sentence"},
 "title_thumbnail_promise": "does the video deliver what the title promises? one or two sentences",
 "strengths": ["what works well"],
 "weaknesses": ["what could be better"],
 "audience_fit": "who this video is for and why they'd watch"
}
Use at most 12 chapters and 8 key moments. Use [] when there is nothing.`;

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

const REEL_PROMPT = VIDEO_PROMPT.replace("You are a YouTube content analyst. Watch this video", "You are an Instagram content analyst. Watch this reel")
  .replace('"format": "e.g. review, vlog, tutorial, reaction, short, interview, live stream"', '"format": "e.g. reel, tutorial, skit, vlog, reaction, trend/meme, talking head"')
  .replace('"first_30s": "what happens in the first 30 seconds"', '"first_30s": "what happens in the first 3 seconds (the scroll-stopper)"')
  .replace('"title_thumbnail_promise": "does the video deliver what the title promises? one or two sentences"',
    '"title_thumbnail_promise": "does the reel deliver what the caption and cover promise? one or two sentences"')
  .replace("e.g. subscribe ask at 0:45, link in description", "e.g. follow ask at 0:12, link in bio, comment a keyword");

const INLINE_MAX = 14 * 1024 * 1024; // larger files go through Gemini's file upload (requests are capped at ~20 MB)

/** Download a reel (Instagram's own video link) and give it to Gemini: inline when small, else via the Files API. */
async function reelPart(url: string, key: string): Promise<Record<string, unknown>> {
  const maxMb = Number(process.env.IG_VIDEO_MAX_MB ?? 60);
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (res.status === 403 || res.status === 410) throw new Error("Instagram's video link has expired; it refreshes on the next scan of this account");
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > maxMb * 1024 * 1024) throw new Error(`reel is larger than ${maxMb} MB`);
  const mime = (res.headers.get("content-type") ?? "video/mp4").split(";")[0].startsWith("video/") ? (res.headers.get("content-type") ?? "video/mp4").split(";")[0] : "video/mp4";
  if (bytes.length <= INLINE_MAX) return { inline_data: { mime_type: mime, data: bytes.toString("base64") } };
  const base = (process.env.GEMINI_NATIVE_BASE ?? GEMINI).replace(/\/v1beta$/, "");
  const up = await fetch(`${base}/upload/v1beta/files?uploadType=media`, {
    method: "POST", headers: { "x-goog-api-key": key, "Content-Type": mime }, body: bytes, signal: AbortSignal.timeout(120000) });
  if (!up.ok) throw new Error(`upload to Gemini failed (${up.status})`);
  let file = (await up.json()).file as { name: string; uri: string; state?: string; mimeType?: string };
  for (let i = 0; i < 20 && file.state === "PROCESSING"; i++) { // Gemini prepares videos before they can be used
    await new Promise((r) => setTimeout(r, 3000));
    file = await (await fetch(`${base}/v1beta/${file.name}`, { headers: { "x-goog-api-key": key } })).json();
  }
  if (file.state && file.state !== "ACTIVE") throw new Error(`Gemini couldn't process the reel (${file.state})`);
  return { file_data: { mime_type: file.mimeType ?? mime, file_uri: file.uri } };
}

/** Seconds of video analysed today (free tier: 8 hours/day of YouTube video). */
async function secondsToday(): Promise<number> {
  const [r] = await sql()`select coalesce(sum(tokens), 0)::int as s from llm_usage where day = ${quotaDay()} and model_key like 'video/%'`;
  return (r?.s as number) ?? 0;
}

/** Gemini models for watching videos: the ones this key can use today (newest first), retired ones never tried. */
async function videoModels(): Promise<string[]> {
  // Up to 5 (Flash-Lite and Flash): when Google says one is busy (503 "high demand"), the next one usually isn't.
  const found = (await geminiModelList()).filter((m) => !/(^|-)[12]\.\d+-/.test(m));
  return found.length ? found.slice(0, 5) : ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash"];
}

export async function analyseVideo(videoId: string): Promise<{ ok: boolean; message: string }> {
  await ensureVideoTables();
  const db = sql();
  const key = splitKeys(process.env.GEMINI_API_KEY)[0];
  if (!key) return { ok: false, message: "Video analysis needs GEMINI_API_KEY in Vercel." };
  const ig = videoId.startsWith("ig_");
  const [v] = ig ? await db`select id, title, duration, media_url from videos where id = ${videoId}`
    : await db`select id, title, duration from videos where id = ${videoId}`;
  if (!v) return { ok: false, message: "Video not found." };
  if (ig && !v.media_url) return { ok: false, message: "Only reels and video posts can be watched (this post has no video, or its link hasn't arrived yet)." };
  const seconds = durationSeconds(v.duration as string) || (ig ? 60 : 0);
  const maxMinutes = Number(process.env.VIDEO_AI_MAX_MINUTES ?? 60);
  if (seconds > maxMinutes * 60) {
    await db`insert into video_analysis (video_id, status, error) values (${videoId}, 'skipped', ${`Longer than ${maxMinutes} minutes`})
      on conflict (video_id) do update set status = 'skipped', error = excluded.error`;
    return { ok: false, message: `This video is longer than ${maxMinutes} minutes, which is too long for the free tier.` };
  }
  const dailyCap = Number(process.env.VIDEO_AI_DAILY_SECONDS ?? 7 * 3600); // keep under Google's 8 h/day
  if ((await secondsToday()) + seconds > dailyCap) return { ok: false, message: "Today's free video-analysis allowance is used up; try again tomorrow." };

  // YouTube: Gemini fetches the video by its link. Instagram: we download the reel and hand Gemini the file.
  let videoPart: Record<string, unknown> = { file_data: { file_uri: `https://www.youtube.com/watch?v=${videoId}` } };
  if (ig) {
    try {
      videoPart = await reelPart(String(v.media_url), key);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      await db`insert into video_analysis (video_id, status, error) values (${videoId}, 'error', ${why.slice(0, 500)})
        on conflict (video_id) do update set status = 'error', error = excluded.error, created_at = (now() at time zone 'utc')`;
      return { ok: false, message: `Couldn't get the reel: ${why.slice(0, 160)}` };
    }
  }
  // Models Google still offers this key (discovered), so a retired model never costs a wasted attempt.
  const models = process.env.GEMINI_VIDEO_MODELS ? process.env.GEMINI_VIDEO_MODELS.split(",").map((m) => m.trim()) : await videoModels();
  const base = process.env.GEMINI_NATIVE_BASE ?? GEMINI; // overridable only for tests
  let lastError = "";
  const errors: string[] = [];
  const attempts = models.flatMap((m) => [m, m]); // each model gets one retry after a short wait (Google often answers 503 "high demand")
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i % 2 === 1) {
      if (!/: (429|500|502|503|504) |no answer/.test(lastError)) continue; // only retry busy/temporary errors
      await new Promise((r) => setTimeout(r, Number(process.env.VIDEO_AI_RETRY_MS ?? 4000)));
    }
    const body = {
      contents: [{ parts: [videoPart, { text: ig ? REEL_PROMPT : VIDEO_PROMPT }] }],
      generationConfig: {
        responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 6000,
        mediaResolution: "MEDIA_RESOLUTION_LOW", // ~100 tokens per second of video instead of ~300
        ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    };
    let res: Response;
    try {
      res = await fetch(`${base}/models/${model}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(240000),
      });
    } catch {
      lastError = `${model}: no answer in time`;
      errors.push(lastError);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 160);
      try { msg = JSON.parse(text).error?.message?.slice(0, 160) ?? msg; } catch { /* keep text */ }
      lastError = `${model}: ${res.status} ${msg}`;
      errors.push(lastError);
      if (res.status === 400 && /video|duration|too long|token/i.test(text)) break; // the video itself is the problem
      continue;
    }
    try {
      const payload = JSON.parse(text);
      const raw = payload.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      const data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      await db`insert into video_analysis (video_id, status, model, duration_s, data, error, created_at)
        values (${videoId}, 'done', ${model}, ${seconds}, ${JSON.stringify(data)}, null, (now() at time zone 'utc'))
        on conflict (video_id) do update set status = 'done', model = excluded.model, duration_s = excluded.duration_s,
          data = excluded.data, error = null, created_at = excluded.created_at`;
      await db`insert into llm_usage (day, model_key, requests, tokens, exhausted) values (${quotaDay()}, ${"video/" + model}, 1, ${seconds}, false)
        on conflict (day, model_key) do update set requests = llm_usage.requests + 1, tokens = llm_usage.tokens + excluded.tokens`;
      return { ok: true, message: "Video analysed." };
    } catch {
      lastError = `${model}: unreadable answer`;
      errors.push(lastError);
    }
  }
  if (errors.length) lastError = [...new Set(errors)].join(" | ");
  console.log(`[video-analysis] ${videoId} failed: ${lastError.slice(0, 300)}`);
  await db`insert into video_analysis (video_id, status, error) values (${videoId}, 'error', ${lastError.slice(0, 500)})
    on conflict (video_id) do update set status = 'error', error = excluded.error, created_at = (now() at time zone 'utc')`;
  return { ok: false, message: `The AI couldn't analyse this video: ${lastError.slice(0, 160)}` };
}

/** Background: analyse the newest not-yet-analysed videos (from the last 30 days). */
export async function analyseDueVideos(max = 1, untilMs?: number): Promise<{ analysed: number; waiting: number; tried: { videoId: string; title: string; ok: boolean; message: string }[]; note?: string }> {
  if (!process.env.GEMINI_API_KEY) return { analysed: 0, waiting: 0, tried: [], note: "GEMINI_API_KEY is not set" };
  await ensureVideoTables();
  const db = sql();
  const due = await db`
    select v.id, v.title from videos v join channels c on c.id = v.channel_id
    left join video_analysis a on a.video_id = v.id
    where c.active and (c.platform is null or v.media_url is not null)
      and v.published_at >= (now() at time zone 'utc') - interval '30 days'
      and (a.video_id is null -- never tried, or a temporary failure (Google busy) at least 3 hours ago
        or (a.status = 'error' and a.created_at < (now() at time zone 'utc') - interval '3 hours'
            and a.error ~ '(429|500|502|503|504|no answer|unreadable|expired)'))
    order by (a.video_id is not null), v.published_at desc`;
  const tried = [];
  for (const v of due.slice(0, max)) {
    if (untilMs && tried.length && Date.now() > untilMs) break; // keep watching while there's time (reels take seconds)
    const r = await analyseVideo(v.id as string);
    console.log(`[video-analysis] ${v.id} "${String(v.title).slice(0, 60)}": ${r.ok ? "done" : r.message}`);
    tried.push({ videoId: v.id as string, title: v.title as string, ...r });
  }
  const note = due.length ? undefined : "No new videos from the last 30 days are waiting; use the button on a video page for older ones.";
  if (note) console.log(`[video-analysis] ${note}`);
  return { analysed: tried.filter((t) => t.ok).length, waiting: Math.max(0, due.length - tried.length), tried, note };
}

export async function recentAnalyses(limit = 8) {
  await ensureVideoTables();
  return (await sql()`
    select a.video_id, v.title, a.status, a.model, a.error, a.duration_s, a.created_at
    from video_analysis a join videos v on v.id = a.video_id order by a.created_at desc limit ${limit}`) as unknown as
    { video_id: string; title: string; status: string; model: string | null; error: string | null; duration_s: number | null; created_at: string }[];
}

export type VideoAnalysis = { status: string; model: string | null; data: Record<string, unknown> | null; error: string | null; created_at: string };

export async function getAnalysis(videoId: string): Promise<VideoAnalysis | null> {
  await ensureVideoTables();
  const [r] = await sql()`select status, model, data, error, created_at from video_analysis where video_id = ${videoId}`;
  if (!r) return null;
  let data = null;
  try { data = r.data ? JSON.parse(r.data as string) : null; } catch { /* ignore */ }
  return { status: r.status as string, model: (r.model as string) ?? null, data, error: (r.error as string) ?? null, created_at: r.created_at as string };
}

/* ================================================================== moments from comment timestamps */
export type Moment = { second: number; label: string; mentions: number; likes: number; examples: { text: string; likes: number }[] };

const TS = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g;
const fmt = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}`) + `:${String(s % 60).padStart(2, "0")}`;

/** Group timestamps written in comments into 20-second windows and rank them. */
export async function commentMoments(videoId: string, durationS: number): Promise<{ moments: Moment[]; histogram: { second: number; mentions: number }[] }> {
  const rows = await sql()`
    select text, like_count from comments
    where video_id = ${videoId} and text ~ '[0-9]:[0-5][0-9]' and (is_spam is null or not is_spam) limit 5000`;
  const bucket = 20;
  const map = new Map<number, Moment>();
  for (const r of rows) {
    const text = String(r.text);
    const seen = new Set<number>();
    for (const m of text.matchAll(TS)) {
      const s = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      if (Number(m[3]) > 59 || (durationS && s > durationS + 5)) continue;
      const b = Math.floor(s / bucket) * bucket;
      if (seen.has(b)) continue;
      seen.add(b);
      const cur = map.get(b) ?? { second: b, label: fmt(b), mentions: 0, likes: 0, examples: [] };
      cur.mentions++; cur.likes += Number(r.like_count ?? 0);
      if (cur.examples.length < 3) cur.examples.push({ text: text.slice(0, 200), likes: Number(r.like_count ?? 0) });
      map.set(b, cur);
    }
  }
  const all = [...map.values()];
  for (const m of all) m.examples.sort((a, b) => b.likes - a.likes);
  const moments = [...all].sort((a, b) => b.mentions + b.likes / 50 - (a.mentions + a.likes / 50)).slice(0, 8);
  const histogram = all.sort((a, b) => a.second - b.second).map((m) => ({ second: m.second, mentions: m.mentions }));
  return { moments, histogram };
}

/* ================================================================== performance vs the channel */
export type Performance = {
  views: number; likes: number; comments: number; age_days: number;
  like_rate: number | null; comment_rate: number | null; views_per_day: number | null;
  channel: { like_rate: number | null; comment_rate: number | null; views: number | null };
  percentile: { views: number | null; like_rate: number | null; comment_rate: number | null };
  dislikes_estimate: number | null; dislike_ratio: number | null;
  meta: { tags: string[]; category: string | null; definition: string | null; captions: boolean | null; language: string | null; topics: string[] };
};

const CATEGORIES: Record<string, string> = { "1": "Film & Animation", "2": "Autos & Vehicles", "10": "Music", "15": "Pets & Animals", "17": "Sports",
  "19": "Travel & Events", "20": "Gaming", "22": "People & Blogs", "23": "Comedy", "24": "Entertainment", "25": "News & Politics",
  "26": "Howto & Style", "27": "Education", "28": "Science & Technology", "29": "Nonprofits & Activism" };

export async function performance(videoId: string): Promise<Performance | null> {
  await ensureVideoTables();
  const db = sql();
  const [v] = await db`
    select v.*, extract(epoch from ((now() at time zone 'utc') - v.published_at)) / 86400 as age_days from videos v where v.id = ${videoId}`;
  if (!v) return null;
  const views = Number(v.view_count ?? 0), likes = Number(v.like_count ?? 0), comments = Number(v.comment_count ?? 0);
  const [ch] = await db`
    with vs as (select view_count::float8 as views,
                  case when view_count > 0 then like_count::float8 / view_count end as lr,
                  case when view_count > 0 then comment_count::float8 / view_count end as cr
                from videos where channel_id = ${v.channel_id as string} and view_count > 0
                  and published_at < (now() at time zone 'utc') - interval '3 days')
    select percentile_cont(0.5) within group (order by lr) as lr, percentile_cont(0.5) within group (order by cr) as cr,
           percentile_cont(0.5) within group (order by views) as views,
           (select count(*) from vs)::int as n,
           (select count(*) from vs where views <= ${views})::int as v_below,
           (select count(*) from vs where lr <= ${views ? likes / views : 0})::int as lr_below,
           (select count(*) from vs where cr <= ${views ? comments / views : 0})::int as cr_below
    from vs`;
  const n = (ch?.n as number) ?? 0;
  const pct = (below: unknown) => (n >= 5 ? Math.round((Number(below) / n) * 100) : null);

  // Dislike estimate from Return YouTube Dislike (refreshed at most daily).
  let dislikes = v.ryd_dislikes != null ? Number(v.ryd_dislikes) : null;
  const stale = !v.ryd_fetched_at || Date.now() - new Date(String(v.ryd_fetched_at).replace(" ", "T") + "Z").getTime() > 86400000;
  if (stale && process.env.RYD_DISABLED !== "1") {
    try {
      const res = await fetch(`${process.env.RYD_API_BASE ?? "https://returnyoutubedislikeapi.com"}/votes?videoId=${encodeURIComponent(videoId)}`,
        { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "creator-pulse (personal analytics)" } });
      if (res.ok) {
        const j = await res.json();
        if (typeof j.dislikes === "number") {
          dislikes = j.dislikes;
          await db`update videos set ryd_dislikes = ${dislikes}, ryd_fetched_at = (now() at time zone 'utc') where id = ${videoId}`;
        }
      }
    } catch { /* estimate is optional */ }
  }
  const age = Math.max(Number(v.age_days ?? 0), 0.01);
  return {
    views, likes, comments, age_days: age,
    like_rate: views ? likes / views : null, comment_rate: views ? comments / views : null, views_per_day: age >= 1 ? views / age : null, // under a day old, a per-day rate is a wild extrapolation
    channel: { like_rate: (ch?.lr as number) ?? null, comment_rate: (ch?.cr as number) ?? null, views: (ch?.views as number) ?? null },
    percentile: { views: pct(ch?.v_below), like_rate: pct(ch?.lr_below), comment_rate: pct(ch?.cr_below) },
    dislikes_estimate: dislikes, dislike_ratio: dislikes != null && likes + dislikes > 0 ? dislikes / (likes + dislikes) : null,
    meta: {
      tags: v.tags ? String(v.tags).split("|").filter(Boolean).slice(0, 30) : [],
      category: v.category_id ? CATEGORIES[String(v.category_id)] ?? String(v.category_id) : null,
      definition: (v.definition as string) ?? null, captions: (v.has_captions as boolean) ?? null,
      language: (v.default_language as string) ?? null,
      topics: v.topic_categories ? String(v.topic_categories).split("|").map((u) => decodeURIComponent(u.split("/").pop() ?? "").replace(/_/g, " ")).filter(Boolean) : [],
    },
  };
}
