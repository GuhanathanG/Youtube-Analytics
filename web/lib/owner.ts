import "server-only";
import crypto from "node:crypto";
import { sql, ensureRls } from "./db";

/**
 * "Connect your channel": the channel owner signs in with Google once (read-only scopes), and the
 * engine pulls private YouTube Analytics every few hours: watch time, how much of each video people
 * watch, subscribers gained, traffic sources and (where Google allows) impressions and click-through rate.
 *
 * The refresh token is encrypted (AES-256-GCM) with a key derived from TOKEN_KEY (or APP_PASSWORD +
 * CRON_SECRET). Setup: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Vercel (docs/CONNECT_CHANNEL.md).
 */
const AUTH = () => process.env.GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = () => process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const YT = () => process.env.YOUTUBE_API_BASE ?? "https://www.googleapis.com/youtube/v3";
const YTA = () => process.env.YT_ANALYTICS_BASE ?? "https://youtubeanalytics.googleapis.com/v2";
export const SCOPES = ["https://www.googleapis.com/auth/yt-analytics.readonly", "https://www.googleapis.com/auth/youtube.readonly"];
export const ownerConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

let ready = false;
async function ensureTables() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists channel_auth (channel_id text primary key, token text not null, title text,
    connected_at timestamp not null default (now() at time zone 'utc'), pulled_at timestamp, error text)`;
  await db`create table if not exists owner_reports (channel_id text primary key, updated_at timestamp not null, data text not null)`;
  await ensureRls("channel_auth");
  await ensureRls("owner_reports");
  ready = true;
}

/* ------------------------------------------------------------------ token encryption */
function key(): Buffer {
  const secret = process.env.TOKEN_KEY ?? `${process.env.APP_PASSWORD ?? ""}|${process.env.CRON_SECRET ?? ""}`;
  return crypto.createHash("sha256").update(`creator-pulse-token-v1|${secret}`).digest();
}
export function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
export function unseal(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch { return null; }
}

/* ------------------------------------------------------------------ sign-in flow */
/** Where Google sends the owner back (must match the address registered in Google Cloud). */
export function redirectUri(origin: string): string {
  const host = process.env.SITE_HOST ?? (process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : null);
  return `${host ? `https://${host}` : origin}/api/oauth/google/callback`;
}

export function authUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", redirect_uri: redirectUri, response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
  return `${AUTH()}?${p}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN(), { method: "POST", body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...params }), signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? `Google said ${res.status}`);
  return data;
}

/** Finish sign-in: store the (encrypted) refresh token for the channel that signed in. */
export async function completeSignIn(code: string, redirectUri: string): Promise<{ channelId: string; title: string }> {
  await ensureTables();
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  if (!t.refresh_token) throw new Error("Google didn't return a long-term key. Remove the app's access in your Google account and connect again.");
  const me = await fetch(`${YT()}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(15_000) })
    .then((r) => r.json()) as { items?: { id: string; snippet?: { title?: string } }[] };
  const ch = me.items?.[0];
  if (!ch) throw new Error("This Google account has no YouTube channel.");
  const db = sql();
  await db`insert into channel_auth (channel_id, token, title) values (${ch.id}, ${seal(t.refresh_token)}, ${ch.snippet?.title ?? null})
    on conflict (channel_id) do update set token = excluded.token, title = excluded.title, connected_at = (now() at time zone 'utc'), error = null, pulled_at = null`;
  const [known] = await db`select 1 from channels where id = ${ch.id}`;
  if (!known) await db`insert into channel_requests (query, status, created_at) values (${ch.id}, 'pending', (now() at time zone 'utc'))`;
  return { channelId: ch.id, title: ch.snippet?.title ?? ch.id };
}

export async function connections(): Promise<{ channel_id: string; title: string | null; connected_at: string; pulled_at: string | null; error: string | null }[]> {
  await ensureTables();
  return (await sql()`select channel_id, title, connected_at, pulled_at, error from channel_auth order by connected_at`) as never;
}

export async function disconnect(channelId: string) {
  await ensureTables();
  await sql()`delete from channel_auth where channel_id = ${channelId}`;
  await sql()`delete from owner_reports where channel_id = ${channelId}`;
}

/* ------------------------------------------------------------------ reports */
export type OwnerReport = {
  range: { start: string; end: string };
  totals: { views: number; minutes: number; avgViewDuration: number | null; avgViewPct: number | null; subsGained: number; subsLost: number };
  videos: { id: string; views: number; minutes: number; avgViewDuration: number; avgViewPct: number; subsGained: number }[];
  daily: { day: string; views: number; minutes: number; subsGained: number; impressions?: number | null; ctr?: number | null }[];
  traffic: { source: string; views: number }[];
  reach: boolean;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

async function report(access: string, params: Record<string, string>) {
  const res = await fetch(`${YTA()}/reports?${new URLSearchParams({ ids: "channel==MINE", ...params })}`,
    { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(20_000) });
  const data = await res.json().catch(() => ({})) as { columnHeaders?: { name: string }[]; rows?: (string | number)[][]; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `YouTube Analytics said ${res.status}`);
  const names = (data.columnHeaders ?? []).map((h) => h.name);
  return (data.rows ?? []).map((r) => Object.fromEntries(names.map((n, k) => [n, r[k]])) as Record<string, string | number>);
}

export async function pullReport(channelId: string): Promise<OwnerReport> {
  await ensureTables();
  const [a] = await sql()`select token from channel_auth where channel_id = ${channelId}`;
  const refresh = a ? unseal(a.token as string) : null;
  if (!refresh) throw new Error("Not connected (or the encryption key changed): connect the channel again.");
  const { access_token: access } = await tokenRequest({ refresh_token: refresh, grant_type: "refresh_token" });
  const end = new Date(Date.now() - 86400000), start = new Date(Date.now() - 29 * 86400000);
  const range = { startDate: day(start), endDate: day(end) };
  const core = "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost";
  const [videos, daily, traffic, totals] = await Promise.all([
    report(access!, { ...range, metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained", dimensions: "video", sort: "-views", maxResults: "200" }),
    report(access!, { ...range, metrics: "views,estimatedMinutesWatched,subscribersGained", dimensions: "day", sort: "day" }),
    report(access!, { ...range, metrics: "views", dimensions: "insightTrafficSourceType", sort: "-views" }),
    report(access!, { ...range, metrics: core }),
  ]);
  // Impressions and click-through rate: only some channels/regions get these from the API, by day.
  let reach = false;
  const byDay = new Map(daily.map((d) => [String(d.day), d]));
  try {
    for (const r of await report(access!, { ...range, metrics: "videoThumbnailImpressions,videoThumbnailImpressionsClickRate", dimensions: "day", sort: "day" })) {
      const d = byDay.get(String(r.day));
      if (d) { d.impressions = Number(r.videoThumbnailImpressions); d.ctr = Number(r.videoThumbnailImpressionsClickRate); reach = true; }
    }
  } catch { /* not available for this channel */ }
  const t = totals[0] ?? {};
  const out: OwnerReport = {
    range: { start: range.startDate, end: range.endDate }, reach,
    totals: { views: Number(t.views ?? 0), minutes: Number(t.estimatedMinutesWatched ?? 0), avgViewDuration: t.averageViewDuration !== undefined ? Number(t.averageViewDuration) : null,
      avgViewPct: t.averageViewPercentage !== undefined ? Number(t.averageViewPercentage) : null, subsGained: Number(t.subscribersGained ?? 0), subsLost: Number(t.subscribersLost ?? 0) },
    videos: videos.map((v) => ({ id: String(v.video), views: Number(v.views), minutes: Number(v.estimatedMinutesWatched), avgViewDuration: Number(v.averageViewDuration),
      avgViewPct: Number(v.averageViewPercentage), subsGained: Number(v.subscribersGained) })),
    daily: [...byDay.values()].map((d) => ({ day: String(d.day), views: Number(d.views), minutes: Number(d.estimatedMinutesWatched), subsGained: Number(d.subscribersGained),
      impressions: d.impressions === undefined ? null : Number(d.impressions), ctr: d.ctr === undefined ? null : Number(d.ctr) })),
    traffic: traffic.map((r) => ({ source: String(r.insightTrafficSourceType), views: Number(r.views) })),
  };
  await sql()`insert into owner_reports (channel_id, updated_at, data) values (${channelId}, (now() at time zone 'utc'), ${JSON.stringify(out)})
    on conflict (channel_id) do update set updated_at = excluded.updated_at, data = excluded.data`;
  await sql()`update channel_auth set pulled_at = (now() at time zone 'utc'), error = null where channel_id = ${channelId}`;
  return out;
}

/** Engine step: refresh one connected channel's private report when it's older than OWNER_PULL_HOURS (6). */
export async function pullDueReports(): Promise<number> {
  if (!ownerConfigured()) return 0;
  await ensureTables();
  const hours = Number(process.env.OWNER_PULL_HOURS ?? 6);
  const due = await sql()`select channel_id from channel_auth where pulled_at is null or pulled_at < (now() at time zone 'utc') - make_interval(hours => ${hours})
    order by pulled_at nulls first limit 1`;
  let n = 0;
  for (const d of due) {
    try { await pullReport(d.channel_id as string); n++; }
    catch (e) { await sql()`update channel_auth set pulled_at = (now() at time zone 'utc'), error = ${e instanceof Error ? e.message.slice(0, 300) : "failed"} where channel_id = ${d.channel_id as string}`; }
  }
  return n;
}

export async function ownerReport(channelId: string): Promise<(OwnerReport & { updated_at: string }) | null> {
  try { await ensureTables(); } catch { return null; }
  const [r] = await sql()`select data, updated_at from owner_reports where channel_id = ${channelId}`;
  if (!r) return null;
  try { return { ...(JSON.parse(r.data as string) as OwnerReport), updated_at: r.updated_at as string }; } catch { return null; }
}

export const TRAFFIC_LABELS: Record<string, string> = {
  YT_SEARCH: "YouTube search", RELATED_VIDEO: "Suggested videos", SUBSCRIBER: "Subscriptions feed", BROWSE: "Home / browse",
  EXT_URL: "External sites", NO_LINK_OTHER: "Direct / unknown", PLAYLIST: "Playlists", SHORTS: "Shorts feed", NOTIFICATION: "Notifications",
  YT_CHANNEL: "Channel pages", END_SCREEN: "End screens", HASHTAGS: "Hashtags", ANNOTATION: "Cards", YT_OTHER_PAGE: "Other YouTube pages",
  CAMPAIGN_CARD: "Campaign cards", SOUND_PAGE: "Sound pages", LIVE_REDIRECT: "Live redirects", VIDEO_REMIXES: "Remixes", IMMERSIVE_LIVE: "Live feed",
};
