import "server-only";
import { sql, ensureRls, ensureColumns, ensureIndex } from "./db";
import { fetchComments, fetchPostHistory, fetchProfile, sourceKeys, sourceOrder, ALL_SOURCES, type Attempt, type IgComment, type IgPost, type IgProfile, type SourceName } from "./ig-sources";

/**
 * Instagram, collected from several providers (lib/ig-sources.ts): the official API and the cheap/free
 * scraping APIs are tried first and answer straight away; Apify's scraper (APIFY_TOKEN) is the last
 * resort, used only when none of them could answer.
 *
 * An Instagram account is stored like a YouTube channel (id "ig_<username>", platform "instagram"),
 * its posts like videos (id "ig_<shortCode>") and their comments like comments. So everything that
 * reads comments — the AI labels, briefings, Creator Memory, Ask AI, people pages, analytics —
 * works for Instagram too, with no extra steps.
 *
 * Apify runs take from ~20 seconds to a few minutes, longer than one engine run. So the engine
 * starts a run, and a later engine run (2 minutes on) collects the results. Spending is capped:
 * IG_MONTHLY_USD (default $4.50 of the free plan's $5) spread evenly over the days left in the month.
 */

const API = () => process.env.APIFY_API_BASE ?? "https://api.apify.com";
const ACTOR = () => (process.env.IG_ACTOR ?? "apify~instagram-scraper").replace("/", "~");
const apifyConfigured = () => !!process.env.APIFY_TOKEN;
export const instagramConfigured = () => apifyConfigured() || sourceOrder(process.env).length > 0;
/** Price per result in USD (Apify's Instagram scraper is about $2.70 per 1,000 results). */
const PRICE = () => Number(process.env.IG_PRICE_PER_RESULT ?? 0.0027);
const MONTHLY = () => Number(process.env.IG_MONTHLY_USD ?? 4.5);

const nowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const ts = (iso?: string | null) => (iso ? String(iso).replace("T", " ").replace(/Z$|\.\d+Z?$|[+-]\d\d:?\d\d$/, "").slice(0, 19) : null);
const num = (v: unknown) => (v === undefined || v === null || v === "" || Number(v) < 0 ? null : Math.round(Number(v)));

let ready = false;
export async function ensureInstagram() {
  if (ready) return;
  const db = sql();
  await ensureColumns("channels", [["platform", "text"]]);
  // Direct link to a reel's video file (from the scraper; Instagram's links expire after a few days, each scan refreshes them).
  await ensureColumns("videos", [["media_url", "text"]]);
  await db`create table if not exists ig_runs (
    id text primary key, channel_id text not null, kind text not null, targets text, status text not null,
    dataset_id text, started_at timestamp not null, finished_at timestamp, items integer, cost_usd double precision,
    error text)`;
  await ensureColumns("ig_runs", [["source", "text"]]); // which provider (null = Apify)
  await ensureIndex("ix_ig_runs_channel", "create index if not exists ix_ig_runs_channel on ig_runs (channel_id, started_at desc)");
  await ensureRls("ig_runs");
  ready = true;
}

/** "@name", "name" or an instagram.com link → the username (lowercase), or null. */
export function parseInstagram(input: string): string | null {
  let s = input.trim();
  const m = s.match(/instagram\.com\/([^/?#]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "").toLowerCase();
  if (["p", "reel", "reels", "stories", "explore", "tv"].includes(s)) return null;
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : null;
}

export const looksLikeInstagram = (q: string) => /instagram\.com\//i.test(q) || /^ig:/i.test(q.trim());

/* ------------------------------------------------------------------ Apify calls */
type ApifyRun = { id: string; status: string; defaultDatasetId?: string; usageTotalUsd?: number };

async function apify(path: string, init?: RequestInit) {
  const res = await fetch(`${API()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Money left: for the month, and for today (the month's remainder spread over the days left). */
export async function instagramBudget(): Promise<{ month: number; spent: number; today: number; todaySpent: number; allowance: number }> {
  await ensureInstagram();
  const [r] = await sql()`select
      coalesce(sum(cost_usd) filter (where started_at >= date_trunc('month', now() at time zone 'utc')), 0)::float8 as month,
      coalesce(sum(cost_usd) filter (where started_at >= date_trunc('day', now() at time zone 'utc')), 0)::float8 as today
    from ig_runs`;
  const spent = Number(r?.month ?? 0), todaySpent = Number(r?.today ?? 0);
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - now.getUTCDate() + 1;
  // What was left at the start of today, shared over the remaining days.
  const allowance = Math.max(0, (MONTHLY() - (spent - todaySpent)) / daysLeft);
  return { month: MONTHLY(), spent, today: Math.max(0, allowance - todaySpent), todaySpent, allowance };
}

/** Start a run; its cost is capped by maxItems and maxTotalChargeUsd. Returns false if there's no money left today. */
async function startRun(channelId: string, kind: "details" | "posts" | "comments", input: Record<string, unknown>,
  expectedItems: number, targets: string[] = [], force = false): Promise<boolean> {
  const budget = await instagramBudget();
  const cap = force ? Math.min(0.25, Math.max(0, budget.month - budget.spent)) : Math.min(1, budget.today);
  const maxItems = Math.min(expectedItems, Math.floor(cap / PRICE()));
  if (maxItems < 1) return false;
  const params = new URLSearchParams({ maxItems: String(maxItems), maxTotalChargeUsd: cap.toFixed(2), timeout: "280", memory: "1024" });
  const { data } = (await apify(`/v2/acts/${ACTOR()}/runs?${params}`, { method: "POST", body: JSON.stringify(input) })) as { data: ApifyRun };
  await sql()`insert into ig_runs (id, channel_id, kind, targets, status, dataset_id, started_at, cost_usd)
    values (${data.id}, ${channelId}, ${kind}, ${JSON.stringify(targets)}, ${data.status ?? "READY"}, ${data.defaultDatasetId ?? null},
            ${nowSql()}, ${maxItems * PRICE()})`; // counted at its cap until it finishes
  return true;
}

const profileUrl = (u: string) => `https://www.instagram.com/${u}/`;
const usernameOf = (channelId: string) => channelId.replace(/^ig_/, "");

/* ------------------------------------------------------------------ the other providers (tried before Apify) */
/** A provider out of credits / rate limited rests this many hours before it's tried again. */
const REST_HOURS = () => Number(process.env.IG_SOURCE_REST_HOURS ?? 12);

/** Providers whose latest attempt said "no more" (credits, key, rate limit) within the rest period. */
async function restingSources(): Promise<Set<SourceName>> {
  const rows = await sql()`select distinct on (source) source, error, started_at from ig_runs where source is not null
    order by source, started_at desc`;
  const cutoff = Date.now() - REST_HOURS() * 3_600_000;
  return new Set(rows.filter((r) => String(r.error ?? "").startsWith("exhausted:")
    && new Date(String(r.started_at).replace(" ", "T") + "Z").getTime() >= cutoff).map((r) => r.source as SourceName));
}

/** Every attempt is kept in ig_runs (cost 0: these use the providers' own free credits), for the Manage page. */
async function recordAttempts(channelId: string, kind: string, attempts: Attempt[], items: number, targets: string[] = []) {
  const db = sql();
  for (const [i, a] of attempts.entries()) {
    await db`insert into ig_runs (id, channel_id, kind, targets, status, started_at, finished_at, items, cost_usd, error, source)
      values (${`${a.source}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`}, ${channelId}, ${kind}, ${JSON.stringify(targets)},
              ${a.ok ? "SUCCEEDED" : "FAILED"}, ${nowSql()}, ${nowSql()}, ${a.ok ? items : 0}, ${0},
              ${a.ok ? null : `${a.exhausted ? "exhausted: " : ""}${a.error ?? "failed"}`.slice(0, 300)}, ${a.source})`;
  }
}

/** Profile + recent posts from the first provider that answers. Returns the number of new posts, or null if none could. */
async function profileNow(channelId: string): Promise<number | null> {
  if (!sourceOrder(process.env).length) return null;
  const attempts: Attempt[] = [];
  const r = await fetchProfile(usernameOf(channelId), process.env, { resting: await restingSources(), attempts });
  await recordAttempts(channelId, "details", attempts, r.profile ? 1 + (r.profile.latestPosts?.length ?? 0) : 0);
  return r.profile ? saveProfile(channelId, r.profile) : null;
}

/**
 * Back catalogue, once per account: when an account has fewer than IG_HISTORY_POSTS (120) posts stored and no
 * history download has succeeded yet, fetch its older posts (about 12 per credit). Gives the outlier finder and
 * the Instagram prediction model enough history. Returns the number of new posts, or null if it didn't run.
 */
async function historyNow(channelId: string): Promise<number | null> {
  const want = Number(process.env.IG_HISTORY_POSTS ?? 120);
  const db = sql();
  const [have] = await db`select count(*)::int as n,
      (select count(*) from ig_runs where channel_id = ${channelId} and kind = 'history' and status = 'SUCCEEDED')::int as done,
      (select count(*) from ig_runs where channel_id = ${channelId} and kind = 'history'
         and started_at >= (now() at time zone 'utc') - interval '1 day')::int as recent
    from videos where channel_id = ${channelId}`;
  if (have.done > 0 || have.n >= want || have.recent >= 3) return null; // done, already enough, or retried enough today
  const attempts: Attempt[] = [];
  const r = await fetchPostHistory(usernameOf(channelId), want, process.env, { resting: await restingSources(), attempts });
  await recordAttempts(channelId, "history", attempts, r.posts?.length ?? 0);
  if (!r.posts) return null;
  const known = new Set((await db`select id from videos where channel_id = ${channelId}`).map((v) => v.id as string));
  const added = await savePosts(channelId, r.posts);
  // The back catalogue is for history and predictions: its existing comments aren't fetched (that would spend
  // provider credits on old posts). Only comments that arrive from now on are read, like any post.
  const fresh = r.posts.map((p) => `ig_${p.shortCode}`).filter((id) => !known.has(id));
  if (fresh.length) await db`update videos set comment_count_checked = comment_count where id in ${db(fresh)} and comment_count_checked is null`;
  return added;
}

/** Newest comments of these posts, each from the first provider that answers. Returns new comment ids and the posts no provider could read. */
async function commentsNow(channelId: string, posts: string[], perPost: number, timeLeft: () => boolean): Promise<{ fresh: string[]; left: string[] }> {
  const fresh: string[] = [], left: string[] = [];
  if (!sourceOrder(process.env, "comments").length) return { fresh, left: posts };
  const resting = await restingSources();
  const db = sql();
  for (const videoId of posts) {
    if (!timeLeft()) { left.push(videoId); continue; }
    const attempts: Attempt[] = [];
    const r = await fetchComments(videoId.replace(/^ig_/, ""), perPost, process.env, { resting, attempts });
    for (const a of attempts) if (a.exhausted) resting.add(a.source);
    await recordAttempts(channelId, "comments", attempts, r.comments?.length ?? 0, [videoId]);
    if (!r.comments) { left.push(videoId); continue; }
    fresh.push(...(await saveComments(channelId, r.comments, [videoId])));
    await db`update videos set comment_count_checked = comment_count, comments_checked_at = ${nowSql()},
        latest_comment_at = coalesce((select max(published_at) from comments c where c.video_id = videos.id), latest_comment_at)
      where id = ${videoId}`;
  }
  return { fresh, left };
}

/* ------------------------------------------------------------------ add an account */
export async function addInstagramNow(input: string): Promise<{ ok: boolean; message: string; channelId?: string }> {
  const u = parseInstagram(input.replace(/^ig:/i, ""));
  if (!u) return { ok: false, message: "That doesn't look like an Instagram username. Try @name or the profile link." };
  if (!instagramConfigured()) return { ok: false, message: "Add an Instagram data key in Vercel (e.g. SCRAPECREATORS_API_KEY, HIKERAPI_KEY or APIFY_TOKEN) to watch Instagram accounts." };
  await ensureInstagram();
  const db = sql();
  const id = `ig_${u}`;
  await db`insert into channels (id, title, handle, platform, active, videos_backfilled, added_at)
    values (${id}, ${"@" + u}, ${"@" + u}, 'instagram', true, true, ${nowSql()})
    on conflict (id) do update set active = true, platform = 'instagram'`;
  await db`insert into channel_requests (query, status, channel_id, created_at) values (${input}, 'done', ${id}, ${nowSql()})`;
  // The quick providers answer at once (profile and the newest posts); Apify only if none of them can.
  const quick = await profileNow(id).catch(() => null);
  if (quick !== null) return { ok: true, channelId: id, message: `Now watching @${u} on Instagram. Profile and recent posts are in; comments follow within minutes.` };
  if (!apifyConfigured()) return { ok: true, channelId: id, message: `Added @${u}, but no Instagram provider could read it right now. The engine will keep trying.` };
  const [running] = await db`select 1 from ig_runs where channel_id = ${id} and status in ('READY', 'RUNNING')`;
  if (!running) {
    const started = await startRun(id, "details", { directUrls: [profileUrl(u)], resultsType: "details", resultsLimit: 1 }, 1, [], true);
    if (started) await startRun(id, "posts", { directUrls: [profileUrl(u)], resultsType: "posts",
      resultsLimit: Number(process.env.IG_HISTORY_POSTS ?? 50), skipPinnedPosts: false }, Number(process.env.IG_HISTORY_POSTS ?? 50), [], true);
    if (!started) return { ok: true, channelId: id, message: `Added @${u}, but this month's Instagram budget is used up. It will load when the budget resets.` };
  }
  return { ok: true, channelId: id, message: `Now watching @${u} on Instagram. Profile and posts arrive in 1–3 minutes, then comments, and the AI reads them.` };
}

/* ------------------------------------------------------------------ saving results */
export const shortCodeFromUrl = (url?: string) => url?.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? null;

function postTitle(p: IgPost) {
  const first = (p.caption ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const kind = p.productType === "clips" ? "Reel" : p.type === "Sidecar" ? "Carousel" : p.type === "Video" ? "Video" : "Post";
  return (first ? first.slice(0, 200) : `${kind} ${p.shortCode ?? ""}`.trim()) || "Instagram post";
}

async function savePosts(channelId: string, posts: IgPost[]): Promise<number> {
  const rows = posts.filter((p) => p.shortCode && !p.error && p.shortCode.length <= 29).map((p) => ({
    id: `ig_${p.shortCode}`, channel_id: channelId, title: postTitle(p), description: p.caption ?? null,
    published_at: ts(p.timestamp), duration: p.videoDuration ? `PT${Math.round(p.videoDuration)}S` : null,
    thumbnail_url: p.displayUrl ?? null, view_count: num(p.videoPlayCount ?? p.videoViewCount), like_count: num(p.likesCount),
    comment_count: num(p.commentsCount) ?? 0, stats_updated_at: nowSql(), comments_disabled: !!p.isCommentsDisabled,
    comments_backfilled: true, tags: p.hashtags?.length ? p.hashtags.join("|").slice(0, 2000) : null,
    media_url: p.videoUrl && /^https?:\/\//.test(p.videoUrl) ? p.videoUrl.slice(0, 2000) : null,
  }));
  if (!rows.length) return 0;
  const db = sql();
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const res = await db`insert into videos ${db(unique)}
    on conflict (id) do update set title = excluded.title, description = excluded.description, thumbnail_url = excluded.thumbnail_url,
      view_count = coalesce(excluded.view_count, videos.view_count), like_count = coalesce(excluded.like_count, videos.like_count),
      comment_count = excluded.comment_count, stats_updated_at = excluded.stats_updated_at, comments_disabled = excluded.comments_disabled,
      tags = coalesce(excluded.tags, videos.tags), media_url = coalesce(excluded.media_url, videos.media_url)
    returning id, (xmax = 0) as inserted`;
  // Growth over time, like YouTube (at most every 30 minutes per post).
  await db`insert into video_snapshots (video_id, taken_at, view_count, like_count, comment_count)
    select v.id, (now() at time zone 'utc'), v.view_count, v.like_count, v.comment_count from videos v
    where v.id in ${db(unique.map((r) => r.id))} and v.published_at >= (now() at time zone 'utc') - interval '30 days'
      and not exists (select 1 from video_snapshots s where s.video_id = v.id and s.taken_at >= (now() at time zone 'utc') - interval '30 minutes')`;
  return res.filter((r) => r.inserted).length;
}

async function saveProfile(channelId: string, p: IgProfile): Promise<number> {
  const db = sql();
  if (p.error || !p.username) {
    await db`insert into channel_requests (query, status, error, created_at)
      values (${"@" + usernameOf(channelId)}, 'error', ${`Instagram: ${p.errorDescription ?? p.error ?? "profile not found"}`.slice(0, 300)}, ${nowSql()})`;
    // Don't keep paying to look up an account that isn't there (or is private).
    await db`update channels set active = false where id = ${channelId} and last_synced_at is null`;
    return 0;
  }
  await db`update channels set title = ${p.fullName || "@" + p.username}, handle = ${"@" + p.username},
      description = ${p.biography ?? null}, thumbnail_url = coalesce(${p.profilePicUrlHD ?? p.profilePicUrl ?? null}, thumbnail_url),
      subscriber_count = ${num(p.followersCount)}, video_count = ${num(p.postsCount)}, last_synced_at = ${nowSql()}
    where id = ${channelId}`;
  await db`insert into channel_snapshots (channel_id, taken_at, subscriber_count, view_count, video_count)
    values (${channelId}, ${nowSql()}, ${num(p.followersCount)}, ${null}, ${num(p.postsCount)})`;
  return p.latestPosts?.length ? savePosts(channelId, p.latestPosts) : 0;
}

function commentRow(c: IgComment, videoId: string, channelId: string, parentId: string | null) {
  const owner = c.owner?.id ?? c.ownerId;
  return {
    id: `ig_${c.id}`, video_id: videoId, channel_id: channelId, parent_id: parentId,
    author_name: c.ownerUsername ?? c.owner?.username ?? null, author_channel_id: owner ? `ig_${owner}`.slice(0, 64) : null,
    text: c.text ?? "", like_count: num(c.likesCount) ?? 0, reply_count: num(c.repliesCount) ?? c.replies?.length ?? 0,
    published_at: ts(c.timestamp), updated_at: null, fetched_at: nowSql(),
  };
}

/** Save comments (and their replies); returns the ids that are new. */
async function saveComments(channelId: string, items: IgComment[], targets: string[]): Promise<string[]> {
  const db = sql();
  const known = new Set((await db`select id from videos where id in ${db(targets.length ? targets : ["-"])}`).map((r) => r.id as string));
  const rows = [];
  for (const c of items) {
    if (!c.id || c.error) continue;
    const code = shortCodeFromUrl(c.postUrl);
    const videoId = code ? `ig_${code}` : null;
    if (!videoId) continue;
    if (!known.has(videoId)) { // a post we haven't stored yet (shouldn't happen): make room for it
      const [v] = await db`select id from videos where id = ${videoId}`;
      if (!v) continue;
      known.add(videoId);
    }
    rows.push(commentRow(c, videoId, channelId, null));
    for (const r of c.replies ?? []) if (r.id) rows.push(commentRow(r, videoId, channelId, `ig_${c.id}`));
  }
  if (!rows.length) return [];
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const ids: string[] = [];
  for (let i = 0; i < unique.length; i += 500) {
    const res = await db`insert into comments ${db(unique.slice(i, i + 500))}
      on conflict (id) do update set like_count = excluded.like_count, reply_count = excluded.reply_count, fetched_at = excluded.fetched_at
      returning id, (xmax = 0) as inserted`;
    ids.push(...res.filter((r) => r.inserted).map((r) => r.id as string));
  }
  return ids;
}

/* ------------------------------------------------------------------ the engine step */
export type IgTickResult = { collected: number; started: number; newComments: string[]; newPosts: number; note?: string };

/** Collect finished runs and start the ones that are due. Called by the 2-minute engine. */
export async function instagramTick(timeLeft: () => boolean): Promise<IgTickResult> {
  const out: IgTickResult = { collected: 0, started: 0, newComments: [], newPosts: 0 };
  if (!instagramConfigured()) return out;
  await ensureInstagram();
  const db = sql();

  // 1. Collect runs that have finished.
  const open = apifyConfigured()
    ? await db`select id, channel_id, kind, targets, dataset_id from ig_runs where status in ('READY', 'RUNNING') and source is null order by started_at limit 6`
    : [];
  for (const r of open) {
    if (!timeLeft()) break;
    const { data } = (await apify(`/v2/actor-runs/${r.id}`)) as { data: ApifyRun };
    if (data.status === "READY" || data.status === "RUNNING" || data.status === "TIMING-OUT" || data.status === "ABORTING") continue;
    let items: unknown[] = [];
    let error: string | null = null;
    if (data.defaultDatasetId) {
      try {
        items = (await apify(`/v2/datasets/${data.defaultDatasetId}/items?clean=true&format=json&limit=5000`)) as unknown[];
      } catch (e) { error = e instanceof Error ? e.message : "couldn't read results"; }
    }
    if (data.status !== "SUCCEEDED" && !items.length) error = error ?? `run ${data.status.toLowerCase()}`;
    const channelId = r.channel_id as string;
    const targets = (() => { try { return JSON.parse((r.targets as string) ?? "[]") as string[]; } catch { return []; } })();
    try {
      if (r.kind === "details") for (const p of items as IgProfile[]) await saveProfile(channelId, p);
      if (r.kind === "posts") out.newPosts += await savePosts(channelId, items as IgPost[]);
      if (r.kind === "comments") {
        out.newComments.push(...(await saveComments(channelId, items as IgComment[], targets)));
        if (targets.length) {
          await db`update videos set comment_count_checked = comment_count, comments_checked_at = ${nowSql()},
              latest_comment_at = coalesce((select max(published_at) from comments c where c.video_id = videos.id), latest_comment_at)
            where id in ${db(targets)}`;
        }
      }
    } catch (e) { error = e instanceof Error ? e.message.slice(0, 300) : "couldn't save"; }
    const real = items.filter((i) => !(i as { error?: string }).error).length;
    const cost = Math.max(Number(data.usageTotalUsd ?? 0), Math.max(real, 1) * PRICE());
    await db`update ig_runs set status = ${data.status}, finished_at = ${nowSql()}, items = ${items.length}, cost_usd = ${cost}, error = ${error}
      where id = ${r.id as string}`;
    out.collected++;
  }

  // 2. Start what's due, one run per account at a time.
  const accounts = await db`select c.id from channels c where c.active and c.platform = 'instagram'
    and not exists (select 1 from ig_runs r where r.channel_id = c.id and r.status in ('READY', 'RUNNING'))
    order by c.last_synced_at nulls first`;
  // New posts show up within 2 hours (each check is one result, about $0.003: ~$2/month for two accounts).
  const profileHours = Number(process.env.IG_PROFILE_HOURS ?? 2);
  const commentHours = Number(process.env.IG_COMMENT_HOURS ?? 6);
  for (const a of accounts) {
    if (!timeLeft()) break;
    const id = a.id as string, u = usernameOf(id);
    const [last] = await db`select
        max(started_at) filter (where kind = 'details') as details_at, max(started_at) filter (where kind = 'comments') as comments_at
      from ig_runs where channel_id = ${id}`;
    const hoursSince = (t: unknown) => (t ? (Date.now() - new Date(String(t).replace(" ", "T") + "Z").getTime()) / 3_600_000 : Infinity);
    // Once per account: its back catalogue (older posts), if it has only a few stored.
    const hist = await historyNow(id).catch((e) => { console.log("[instagram history]", e instanceof Error ? e.message : e); return null; });
    if (hist !== null) { out.collected++; out.newPosts += hist; continue; }
    // Profile + newest 12 posts (one result): followers, new posts, likes and comment counts.
    if (hoursSince(last?.details_at) >= profileHours) {
      const quick = await profileNow(id).catch((e) => { console.log("[instagram]", e instanceof Error ? e.message : e); return null; });
      if (quick !== null) { out.collected++; out.newPosts += quick; }
      else if (apifyConfigured()) {
        // Apify answers later (a run), so its comments step waits for the next check.
        if (await startRun(id, "details", { directUrls: [profileUrl(u)], resultsType: "details", resultsLimit: 1 }, 1)) out.started++;
        else { out.note = "Instagram budget for today is used up"; break; }
        continue;
      }
    }
    // Comments of posts whose comment count went up (newest posts first), or never read.
    // Same check as the profile: the profile is due on nearly every check, so comments used to never get a turn.
    // A brand-new post (never read) is fetched straight away, whatever the comment timer says.
    const freshPost = await db`select 1 from videos where channel_id = ${id} and comment_count_checked is null and comment_count > 0
      and not comments_disabled and published_at >= (now() at time zone 'utc') - interval '3 days' limit 1`;
    if (timeLeft() && (hoursSince(last?.comments_at) >= commentHours || freshPost.length)) {
      const due = await db`select id, comment_count from videos where channel_id = ${id} and not comments_disabled and comment_count > 0
          and (comment_count_checked is null or comment_count >= comment_count_checked + ${Number(process.env.IG_MIN_NEW_COMMENTS ?? 3)})
        order by (published_at >= (now() at time zone 'utc') - interval '30 days') desc, published_at desc nulls last
        limit ${Number(process.env.IG_POSTS_PER_RUN ?? 8)}`;
      if (!due.length) continue;
      const perPost = Number(process.env.IG_COMMENTS_PER_POST ?? 50);
      // Quick providers first, post by post; only the posts none of them could read go to Apify.
      const quick = await commentsNow(id, due.map((v) => v.id as string), perPost, timeLeft);
      out.newComments.push(...quick.fresh);
      if (quick.fresh.length || quick.left.length < due.length) out.collected++;
      const rest = due.filter((v) => quick.left.includes(v.id as string));
      if (!rest.length || !apifyConfigured() || !timeLeft()) continue;
      const urls = rest.map((v) => `https://www.instagram.com/p/${String(v.id).replace(/^ig_/, "")}/`);
      const expected = rest.reduce((s, v) => s + Math.min(perPost, Number(v.comment_count ?? 0)), 0);
      if (await startRun(id, "comments", { directUrls: urls, resultsType: "comments", resultsLimit: perPost, isNewestComments: true },
        Math.max(1, expected), rest.map((v) => v.id as string))) out.started++;
      else { out.note = "Instagram budget for today is used up"; break; }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ status for the Manage page */
export type IgStatus = {
  configured: boolean; budget: Awaited<ReturnType<typeof instagramBudget>> | null; accounts: number;
  runs: { id: string; channel_id: string; kind: string; status: string; started_at: string; items: number | null; cost_usd: number | null; error: string | null; source: string | null }[];
  /** Providers in the order they're tried (Apify last), with whether each is set up and whether it's resting. */
  sources: { name: string; keys: number; resting: boolean }[];
};

export async function instagramStatus(): Promise<IgStatus> {
  const order = sourceOrder(process.env);
  const listing = (resting: Set<SourceName>) => [
    ...[...order, ...ALL_SOURCES.filter((x) => !order.includes(x))].map((name) => ({ name, keys: sourceKeys(process.env, name).length, resting: resting.has(name) })),
    { name: "apify", keys: apifyConfigured() ? 1 : 0, resting: false },
  ];
  if (!instagramConfigured()) return { configured: false, budget: null, accounts: 0, runs: [], sources: listing(new Set()) };
  await ensureInstagram();
  const db = sql();
  const [n] = await db`select count(*)::int as n from channels where platform = 'instagram' and active`;
  const runs = await db`select id, channel_id, kind, status, started_at, items, cost_usd, error, source from ig_runs order by started_at desc limit 8`;
  return { configured: true, budget: await instagramBudget(), accounts: n.n as number, runs: runs as never, sources: listing(await restingSources()) };
}
