import "server-only";
import crypto from "node:crypto";
import { sql, ensureRls } from "./db";

/**
 * Instant new-upload detection, without spending YouTube quota:
 *  1. RSS: every channel has a free feed of its 15 newest uploads. The engine reads it on every run
 *     (every 2 minutes) instead of asking the API every 10 minutes.
 *  2. Push (WebSub): YouTube's hub calls /api/websub the moment a watched channel uploads. The engine
 *     keeps each channel's subscription renewed (subscriptions last 5 days).
 * The API's upload list stays as a slow backup (hourly), in case a feed is unavailable.
 */
const RSS_BASE = () => process.env.YOUTUBE_RSS_BASE ?? "https://www.youtube.com";
const HUB = () => process.env.WEBSUB_HUB ?? "https://pubsubhubbub.appspot.com/subscribe";
const topicFor = (channelId: string) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

/** Newest upload ids from a channel's free RSS feed (null if the feed couldn't be read). */
export async function rssLatest(channelId: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${RSS_BASE()}/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "creator-pulse" } });
    if (!res.ok) return null;
    return parseVideoIds(await res.text());
  } catch { return null; }
}

/** Video ids (and their channel) in an Atom feed or a WebSub notification. */
export function parseVideoIds(xml: string): string[] {
  return [...xml.matchAll(/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/g)].map((m) => m[1]);
}
export function parseChannelId(xml: string): string | null {
  return xml.match(/<yt:channelId>(UC[\w-]{22})<\/yt:channelId>/)?.[1] ?? null;
}

/* ------------------------------------------------------------------ WebSub (push) */
let ready = false;
async function ensureTables() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists app_secrets (name text primary key, value text not null)`;
  await db`create table if not exists websub (channel_id text primary key, requested_at timestamp, verified_at timestamp,
    last_push_at timestamp, pushes integer not null default 0, error text)`;
  await ensureRls("app_secrets");
  await ensureRls("websub");
  ready = true;
}

/** Two random values made on first use: the callback key (in the URL) and the signing secret. */
export async function websubSecrets(): Promise<{ key: string; secret: string }> {
  await ensureTables();
  const db = sql();
  const rows = await db`select name, value from app_secrets where name in ('websub_key', 'websub_secret')`;
  const got = Object.fromEntries(rows.map((r) => [r.name as string, r.value as string]));
  if (got.websub_key && got.websub_secret) return { key: got.websub_key, secret: got.websub_secret };
  await db`insert into app_secrets (name, value) values ('websub_key', ${crypto.randomBytes(18).toString("base64url")}),
    ('websub_secret', ${crypto.randomBytes(24).toString("base64url")}) on conflict (name) do nothing`;
  return websubSecrets();
}

function callbackBase(): string | null {
  if (process.env.WEBSUB_CALLBACK_BASE) return process.env.WEBSUB_CALLBACK_BASE;
  const host = process.env.SITE_HOST ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host && process.env.VERCEL_ENV === "production" ? `https://${host}` : null; // the hub needs a public address
}

/** Engine step: (re)subscribe channels whose push subscription is missing or older than 3 days. */
export async function renewSubscriptions(max = 3): Promise<number> {
  const base = callbackBase();
  if (!base) return 0;
  await ensureTables();
  const db = sql();
  const due = await db`select c.id from channels c left join websub w on w.channel_id = c.id
    where c.active and c.platform is null
      and (w.requested_at is null or w.requested_at < (now() at time zone 'utc') - interval '3 days'
           or (w.verified_at is null and w.requested_at < (now() at time zone 'utc') - interval '6 hours'))
    order by w.requested_at nulls first limit ${max}`;
  if (!due.length) return 0;
  const { key, secret } = await websubSecrets();
  let n = 0;
  for (const c of due) {
    const id = c.id as string;
    const body = new URLSearchParams({ "hub.mode": "subscribe", "hub.topic": topicFor(id), "hub.verify": "async",
      "hub.callback": `${base}/api/websub?key=${encodeURIComponent(key)}`, "hub.secret": secret, "hub.lease_seconds": "432000" });
    let error: string | null = null;
    try {
      const res = await fetch(HUB(), { method: "POST", body, signal: AbortSignal.timeout(8000) });
      if (res.status !== 202 && res.status !== 204) error = `hub said ${res.status}`;
    } catch (e) { error = e instanceof Error ? e.message.slice(0, 200) : "hub unreachable"; }
    await db`insert into websub (channel_id, requested_at, error) values (${id}, (now() at time zone 'utc'), ${error})
      on conflict (channel_id) do update set requested_at = excluded.requested_at, error = excluded.error`;
    if (!error) n++;
  }
  return n;
}

/** The hub checks we really asked for a subscription: echo its challenge for channels we watch. */
export async function verifyRequest(params: URLSearchParams): Promise<string | null> {
  const { key } = await websubSecrets();
  if (!safeEq(params.get("key") ?? "", key)) return null;
  const topic = params.get("hub.topic") ?? "";
  const channelId = topic.match(/channel_id=(UC[\w-]{22})/)?.[1];
  const challenge = params.get("hub.challenge");
  if (!channelId || !challenge) return null;
  const db = sql();
  const [c] = await db`select 1 from channels where id = ${channelId} and active`;
  const mode = params.get("hub.mode");
  if (mode === "subscribe" && !c) return null; // not a channel we watch
  if (mode === "subscribe") await db`update websub set verified_at = (now() at time zone 'utc'), error = null where channel_id = ${channelId}`;
  return challenge;
}

/** A push from the hub: check its signature, then return the channel and new video ids. */
export async function readPush(body: string, signature: string | null, key: string | null): Promise<{ channelId: string; ids: string[] } | null> {
  const s = await websubSecrets();
  if (!safeEq(key ?? "", s.key) || !signature) return null;
  const [algo, sig] = signature.split("=");
  if (!["sha1", "sha256"].includes(algo) || !sig) return null;
  const expected = crypto.createHmac(algo, s.secret).update(body).digest("hex");
  if (!safeEq(sig, expected)) return null;
  const channelId = parseChannelId(body);
  const ids = parseVideoIds(body);
  if (!channelId || !ids.length) return { channelId: channelId ?? "", ids: [] };
  await sql()`update websub set last_push_at = (now() at time zone 'utc'), pushes = pushes + 1 where channel_id = ${channelId}`;
  return { channelId, ids };
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
