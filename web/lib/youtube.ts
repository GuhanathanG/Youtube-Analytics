import "server-only";
import { sql } from "./db";
import { quotaDay } from "./queries";

/**
 * YouTube Data API v3 from the website. Uses the same daily quota counter
 * (`quota_usage`) as the background worker, so the two never overspend together.
 */
const API = process.env.YOUTUBE_API_BASE ?? "https://www.googleapis.com/youtube/v3"; // override only for tests

export class QuotaExhausted extends Error {}
export class YouTubeError extends Error {
  constructor(public status: number, public reason: string, message: string) { super(message); }
}

export function youtubeConfigured(): boolean {
  return !!process.env.YOUTUBE_API_KEY;
}

function dailyCap(): number {
  return Number(process.env.DAILY_QUOTA ?? 9500) || 9500;
}

/** Atomically reserve quota units; throws QuotaExhausted when today's budget is used. */
async function spend(units: number) {
  const db = sql();
  const day = quotaDay();
  const [row] = await db`
    insert into quota_usage (day, units) values (${day}, ${units})
    on conflict (day) do update set units = quota_usage.units + excluded.units
    returning units`;
  if ((row.units as number) > dailyCap()) {
    await db`update quota_usage set units = units - ${units} where day = ${day}`;
    throw new QuotaExhausted("YouTube daily quota used up; it resets at midnight Pacific time");
  }
}

async function get<T = Record<string, unknown>>(endpoint: string, params: Record<string, string | number | undefined>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new YouTubeError(0, "noKey", "YOUTUBE_API_KEY is not set in Vercel");
  await spend(1);
  const qs = new URLSearchParams({ key });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${API}/${endpoint}?${qs}`, { cache: "no-store" });
    if (res.status < 500) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  if (!res) throw new YouTubeError(0, "network", "No response from YouTube");
  if (res.status === 200) return (await res.json()) as T;
  let reason = "unknown";
  let message = (await res.text()).slice(0, 300);
  try {
    const err = JSON.parse(message).error;
    message = err?.message ?? message;
    reason = err?.errors?.[0]?.reason ?? reason;
  } catch { /* keep text */ }
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") throw new QuotaExhausted(message);
  throw new YouTubeError(res.status, reason, message);
}

/* ------------------------------------------------------------------ resources */
type Thumbs = { thumbnails?: Record<string, { url: string }> };
export type ChannelItem = {
  id: string;
  snippet?: Thumbs & { title?: string; customUrl?: string; description?: string; country?: string };
  statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};
export type VideoItem = {
  id: string;
  snippet?: Thumbs & { title?: string; description?: string; publishedAt?: string; channelId?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};
export type CommentItem = {
  id: string;
  snippet: { textOriginal?: string; textDisplay?: string; authorDisplayName?: string; authorChannelId?: { value?: string };
    likeCount?: number; publishedAt?: string; updatedAt?: string; parentId?: string };
};
export type ThreadItem = {
  id: string;
  snippet: { totalReplyCount?: number; topLevelComment: CommentItem };
  replies?: { comments?: CommentItem[] };
};

export const thumb = (s?: Thumbs) => s?.thumbnails?.high?.url ?? s?.thumbnails?.medium?.url ?? s?.thumbnails?.default?.url ?? null;

export async function getChannels(opts: { ids?: string[]; handle?: string; username?: string }): Promise<ChannelItem[]> {
  const params: Record<string, string> = { part: "snippet,statistics,contentDetails", maxResults: "50" };
  if (opts.ids?.length) params.id = opts.ids.join(",");
  else if (opts.handle) params.forHandle = opts.handle.startsWith("@") ? opts.handle : "@" + opts.handle;
  else if (opts.username) params.forUsername = opts.username;
  const data = await get<{ items?: ChannelItem[] }>("channels", params);
  return data.items ?? [];
}

export async function getVideos(ids: string[]): Promise<VideoItem[]> {
  const out: VideoItem[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await get<{ items?: VideoItem[] }>("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(","), maxResults: 50 });
    out.push(...(data.items ?? []));
  }
  return out;
}

export async function listUploads(playlistId: string, pageToken?: string) {
  return get<{ items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>("playlistItems",
    { part: "contentDetails", playlistId, maxResults: 50, pageToken });
}

export async function listThreads(videoId: string, pageToken?: string) {
  return get<{ items?: ThreadItem[]; nextPageToken?: string }>("commentThreads",
    { part: "snippet,replies", videoId, order: "time", maxResults: 100, textFormat: "plainText", pageToken });
}

/** Same rules as the Python worker: @handle, channel URL/ID, /user/ URL, or any video URL. */
export function parseChannelQuery(input: string): { kind: "id" | "handle" | "username" | "video" | "unknown"; value: string } {
  let q = input.trim();
  if (!q) return { kind: "unknown", value: "" };
  if (/^UC[\w-]{22}$/.test(q)) return { kind: "id", value: q };
  if (q.startsWith("@")) return { kind: "handle", value: q };
  if (!q.includes("://") && /youtube\.com|youtu\.be/.test(q)) q = "https://" + q;
  if (q.includes("://")) {
    try {
      const url = new URL(q);
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.hostname.endsWith("youtu.be") && parts[0]) return { kind: "video", value: parts[0] };
      if (url.hostname.includes("youtube.com")) {
        if (parts[0]?.startsWith("@")) return { kind: "handle", value: parts[0] };
        if (parts[0] === "channel" && parts[1]) return { kind: "id", value: parts[1] };
        if ((parts[0] === "user" || parts[0] === "c") && parts[1]) return { kind: "username", value: parts[1] };
        if (parts[0] === "watch" && url.searchParams.get("v")) return { kind: "video", value: url.searchParams.get("v")! };
        if (["shorts", "live", "embed"].includes(parts[0] ?? "") && parts[1]) return { kind: "video", value: parts[1] };
      }
    } catch { /* fall through */ }
    return { kind: "unknown", value: q };
  }
  if (/^[\w.-]+$/.test(q)) return { kind: "handle", value: "@" + q };
  return { kind: "unknown", value: q };
}

export async function resolveChannel(input: string): Promise<ChannelItem | null> {
  const { kind, value } = parseChannelQuery(input);
  if (kind === "id") return (await getChannels({ ids: [value] }))[0] ?? null;
  if (kind === "handle") return (await getChannels({ handle: value }))[0] ?? null;
  if (kind === "username") return (await getChannels({ username: value }))[0] ?? (await getChannels({ handle: value }))[0] ?? null;
  if (kind === "video") {
    const v = (await getVideos([value]))[0];
    return v?.snippet?.channelId ? (await getChannels({ ids: [v.snippet.channelId] }))[0] ?? null : null;
  }
  return null;
}
