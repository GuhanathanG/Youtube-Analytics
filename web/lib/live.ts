import "server-only";
import { sql } from "./db";
import { labelBacklog, labelComments } from "./ai";
import { writeDueIdeas, writeDueInsights } from "./insights";
import { ensureVideoTables } from "./video";
import { checkAlerts } from "./alerts";
import { quotaDay } from "./queries";
import {
  QuotaExhausted, YouTubeError, getVideos, listThreads, listUploads, resolveChannel, thumb, youtubeConfigured,
  type ChannelItem, type CommentItem, type ThreadItem, type VideoItem,
} from "./youtube";

/**
 * Live mode: while the website is open it calls `liveTick()` about once a minute.
 * A tick picks up new uploads and new comments for the channels you watch, stores
 * them, and has the AI read the new comments straight away. The heavy work (full
 * history, the bulk sentiment model) stays with the background job.
 */

export type TickResult = {
  status: "ok" | "skipped" | "off" | "quota" | "error";
  message?: string;
  newComments: number;
  newVideos: number;
  labelled: number;
  backfilled?: number;
  aiBacklog?: number;
  insights?: number;
  source?: "browser" | "cron";
  durationMs?: number;
  alerts?: number;
  at: string;
};

const nowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const ts = (iso?: string | null) => (iso ? iso.replace("T", " ").replace(/Z$|\.\d+Z?$/, "").slice(0, 19) : null);
const int = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

let tableReady = false;
async function ensureLiveTable() {
  if (tableReady) return;
  const db = sql();
  await db`create table if not exists live_state (
    id integer primary key, last_tick_at timestamp, last_uploads_at timestamp, last_result text)`;
  await db`alter table live_state add column if not exists last_cron_at timestamp`;
  await db`alter table live_state enable row level security`;
  // Fast "what should the AI read next" without sorting the whole backlog.
  await db`create index if not exists ix_comments_ai_pending on comments (published_at desc) where ai_at is null`;
  await db`insert into live_state (id) values (1) on conflict do nothing`;
  tableReady = true;
}

export async function engineStatus(): Promise<{ lastCronAt: string | null; lastTickAt: string | null; last: TickResult | null }> {
  await ensureLiveTable();
  const [r] = await sql()`select last_cron_at, last_tick_at, last_result from live_state where id = 1`;
  let last = null;
  try { last = r?.last_result ? JSON.parse(r.last_result as string) : null; } catch { /* ignore */ }
  return { lastCronAt: (r?.last_cron_at as string) ?? null, lastTickAt: (r?.last_tick_at as string) ?? null, last };
}

export async function lastTick(): Promise<TickResult | null> {
  await ensureLiveTable();
  const [r] = await sql()`select last_result from live_state where id = 1`;
  try { return r?.last_result ? JSON.parse(r.last_result as string) : null; } catch { return null; }
}

/* ------------------------------------------------------------------ writes */
async function saveChannel(item: ChannelItem) {
  const db = sql();
  const s = item.snippet ?? {}, st = item.statistics ?? {};
  const row = {
    id: item.id, title: s.title ?? "", handle: s.customUrl ?? null, description: s.description ?? null,
    thumbnail_url: thumb(s), country: s.country ?? null,
    uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    subscriber_count: int(st.subscriberCount), view_count: int(st.viewCount), video_count: int(st.videoCount),
    active: true, videos_backfilled: false, added_at: nowSql(), last_synced_at: nowSql(),
  };
  await db`
    insert into channels ${db(row)}
    on conflict (id) do update set title = excluded.title, handle = coalesce(excluded.handle, channels.handle),
      description = excluded.description, thumbnail_url = excluded.thumbnail_url, country = excluded.country,
      uploads_playlist_id = coalesce(excluded.uploads_playlist_id, channels.uploads_playlist_id),
      subscriber_count = excluded.subscriber_count, view_count = excluded.view_count, video_count = excluded.video_count,
      active = true, last_synced_at = excluded.last_synced_at`;
  await db`insert into channel_snapshots (channel_id, taken_at, subscriber_count, view_count, video_count)
    values (${item.id}, ${nowSql()}, ${row.subscriber_count}, ${row.view_count}, ${row.video_count})`;
}

/** Insert or update videos; returns the ids that are new. */
async function saveVideos(channelId: string, items: VideoItem[]): Promise<string[]> {
  if (!items.length) return [];
  const db = sql();
  const rows = items.map((v) => ({
    id: v.id, channel_id: channelId, title: v.snippet?.title ?? "", description: v.snippet?.description ?? null,
    published_at: ts(v.snippet?.publishedAt), duration: v.contentDetails?.duration ?? null, thumbnail_url: thumb(v.snippet),
    view_count: int(v.statistics?.viewCount), like_count: int(v.statistics?.likeCount), comment_count: int(v.statistics?.commentCount),
    stats_updated_at: nowSql(), comments_disabled: v.statistics?.commentCount === undefined, comments_backfilled: false,
    tags: v.snippet?.tags?.join("|").slice(0, 2000) ?? null, category_id: v.snippet?.categoryId ?? null,
    definition: v.contentDetails?.definition ?? null, has_captions: v.contentDetails?.caption ? v.contentDetails.caption === "true" : null,
    default_language: v.snippet?.defaultAudioLanguage ?? v.snippet?.defaultLanguage ?? null,
    topic_categories: v.topicDetails?.topicCategories?.join("|") ?? null,
  }));
  await ensureVideoTables();
  const res = await db`
    insert into videos ${db(rows)}
    on conflict (id) do update set title = excluded.title, view_count = excluded.view_count,
      tags = coalesce(excluded.tags, videos.tags), category_id = coalesce(excluded.category_id, videos.category_id),
      definition = coalesce(excluded.definition, videos.definition), has_captions = coalesce(excluded.has_captions, videos.has_captions),
      default_language = coalesce(excluded.default_language, videos.default_language),
      topic_categories = coalesce(excluded.topic_categories, videos.topic_categories),
      like_count = excluded.like_count, comment_count = excluded.comment_count, stats_updated_at = excluded.stats_updated_at,
      comments_disabled = excluded.comments_disabled
    returning id, (xmax = 0) as inserted`;
  return res.filter((r) => r.inserted).map((r) => r.id as string);
}

function commentRow(c: CommentItem, videoId: string, channelId: string, parentId: string | null, replies = 0) {
  const s = c.snippet;
  return {
    id: c.id, video_id: videoId, channel_id: channelId, parent_id: parentId ?? s.parentId ?? null,
    author_name: s.authorDisplayName ?? null, author_channel_id: s.authorChannelId?.value ?? null,
    text: s.textOriginal ?? s.textDisplay ?? "", like_count: Number(s.likeCount ?? 0), reply_count: replies,
    published_at: ts(s.publishedAt), updated_at: ts(s.updatedAt), fetched_at: nowSql(),
  };
}

/** Store comment threads (plus included replies); returns ids of comments that are new. */
async function saveThreads(videoId: string, channelId: string, threads: ThreadItem[]): Promise<{ ids: string[]; newest: string | null }> {
  const rows = [];
  let newest: string | null = null;
  for (const t of threads) {
    const top = commentRow(t.snippet.topLevelComment, videoId, channelId, null, t.snippet.totalReplyCount ?? 0);
    rows.push(top);
    if (top.published_at && (!newest || top.published_at > newest)) newest = top.published_at;
    for (const r of t.replies?.comments ?? []) rows.push(commentRow(r, videoId, channelId, t.snippet.topLevelComment.id));
  }
  if (!rows.length) return { ids: [], newest };
  const db = sql();
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  const res = await db`
    insert into comments ${db(unique)}
    on conflict (id) do update set text = excluded.text, like_count = excluded.like_count,
      reply_count = excluded.reply_count, updated_at = excluded.updated_at, fetched_at = excluded.fetched_at,
      author_name = excluded.author_name
    returning id, (xmax = 0) as inserted`;
  return { ids: res.filter((r) => r.inserted).map((r) => r.id as string), newest };
}

/** Read a video's newest comments down to the newest one already stored (max `maxPages` pages). */
async function fetchNewComments(v: { id: string; channel_id: string; latest_comment_at: string | null }, maxPages = 3) {
  const db = sql();
  const stop = v.latest_comment_at;
  let token: string | undefined, newest = stop;
  const ids: string[] = [];
  for (let page = 0; page < maxPages; page++) {
    let data;
    try {
      data = await listThreads(v.id, token);
    } catch (e) {
      if (e instanceof YouTubeError && (e.reason === "commentsDisabled" || e.status === 404 || e.status === 403)) {
        await db`update videos set comments_disabled = true, comments_backfilled = true where id = ${v.id}`;
        return ids;
      }
      throw e;
    }
    const items = data.items ?? [];
    const saved = await saveThreads(v.id, v.channel_id, items);
    ids.push(...saved.ids);
    if (saved.newest && (!newest || saved.newest > newest)) newest = saved.newest;
    const reachedKnown = !stop || items.some((t) => (ts(t.snippet.topLevelComment.snippet.publishedAt) ?? "") <= stop);
    token = data.nextPageToken;
    if (reachedKnown || !token) break;
  }
  await db`update videos set latest_comment_at = ${newest}, comment_count_checked = comment_count,
    comments_checked_at = ${nowSql()} where id = ${v.id}`;
  return ids;
}

/* ------------------------------------------------------------------ add a channel right away */
export async function addChannelNow(query: string): Promise<{ ok: boolean; message: string; channelId?: string }> {
  const db = sql();
  if (!youtubeConfigured()) {
    await db`insert into channel_requests (query, status, created_at) values (${query}, 'pending', ${nowSql()})`;
    return { ok: true, message: `Queued ${query}. Add YOUTUBE_API_KEY in Vercel to add channels instantly.` };
  }
  try {
    const item = await resolveChannel(query);
    if (!item) {
      await db`insert into channel_requests (query, status, error, created_at)
        values (${query}, 'error', 'Channel not found. Try the @handle or channel link.', ${nowSql()})`;
      return { ok: false, message: "Couldn't find that channel. Try its @handle or channel link." };
    }
    await saveChannel(item);
    await db`insert into channel_requests (query, status, channel_id, created_at) values (${query}, 'done', ${item.id}, ${nowSql()})`;
    // Bootstrap: newest 50 uploads and the newest comments of the latest 3 videos.
    const playlist = item.contentDetails?.relatedPlaylists?.uploads;
    let commentIds: string[] = [];
    if (playlist) {
      const page = await listUploads(playlist).catch(() => ({ items: [] as { contentDetails: { videoId: string } }[] }));
      const ids = (page.items ?? []).map((i) => i.contentDetails.videoId);
      await saveVideos(item.id, await getVideos(ids));
      const latest = await db`select id, channel_id, latest_comment_at from videos
        where channel_id = ${item.id} and not comments_disabled order by published_at desc nulls last limit 3`;
      for (const v of latest) commentIds.push(...(await fetchNewComments(v as never, 1)));
    }
    commentIds = commentIds.slice(0, 120);
    const labelled = await labelComments(commentIds).catch(() => 0);
    return { ok: true, channelId: item.id,
      message: `Now watching ${item.snippet?.title ?? query}: ${commentIds.length} newest comments loaded${labelled ? `, ${labelled} read by AI` : ""}. Full history keeps downloading in the background.` };
  } catch (e) {
    if (e instanceof QuotaExhausted) {
      await db`insert into channel_requests (query, status, created_at) values (${query}, 'pending', ${nowSql()})`;
      return { ok: true, message: `YouTube's daily quota is used up, so ${query} is queued for tomorrow.` };
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ history download */
/** Download up to `maxPages` pages (100 comments each) of past comments, newest videos first.
 *  Keeps a reserve of the daily quota for live checks. Returns comments saved. */
/** Supabase's free database holds 500 MB; stop downloading history before it fills up. */
export async function storageStatus(): Promise<{ usedMb: number; limitMb: number; nearlyFull: boolean }> {
  const [r] = await sql()`select pg_database_size(current_database())::float8 / 1048576 as mb`;
  const limitMb = Number(process.env.STORAGE_LIMIT_MB ?? 500);
  const usedMb = Math.round((r?.mb as number) ?? 0);
  return { usedMb, limitMb, nearlyFull: usedMb > limitMb * 0.9 };
}

/** Download one video's history, up to `pages` pages. Returns comments saved. */
async function backfillVideo(v: Record<string, unknown>, pages: number, timeLeft: () => boolean): Promise<number> {
  const db = sql();
  let token = (v.comments_page_token as string | null) ?? undefined;
  let newest = (v.latest_comment_at as string | null) ?? null;
  let saved = 0;
  for (let page = 0; page < pages && timeLeft(); page++) {
    let data;
    try {
      data = await listThreads(v.id as string, token);
    } catch (e) {
      if (e instanceof YouTubeError && (e.reason === "commentsDisabled" || e.status === 404 || e.status === 403)) {
        await db`update videos set comments_disabled = true, comments_backfilled = true where id = ${v.id as string}`;
        return saved;
      }
      if (e instanceof YouTubeError && e.status === 400 && token) {
        await db`update videos set comments_page_token = null where id = ${v.id as string}`; // expired token: restart video
        return saved;
      }
      throw e;
    }
    const res = await saveThreads(v.id as string, v.channel_id as string, data.items ?? []);
    saved += (data.items ?? []).length;
    if (res.newest && (!newest || res.newest > newest)) newest = res.newest;
    token = data.nextPageToken;
    if (token) {
      await db`update videos set comments_page_token = ${token}, latest_comment_at = ${newest} where id = ${v.id as string}`;
    } else {
      await db`update videos set comments_page_token = null, comments_backfilled = true,
          comment_count_checked = ${v.comment_count as number}, comments_checked_at = ${nowSql()},
          latest_comment_at = coalesce(${newest}, published_at, (now() at time zone 'utc'))
        where id = ${v.id as string}`;
      break;
    }
  }
  return saved;
}

/** Download past comments for several videos at the same time (newest videos first).
 *  Keeps a reserve of the daily quota for live checks, and stops before the database fills. */
async function backfillSome(maxPages: number, timeLeft: () => boolean): Promise<number> {
  const db = sql();
  const [q] = await db`select units from quota_usage where day = ${quotaDay()}`;
  const reserve = Number(process.env.LIVE_QUOTA_RESERVE ?? 2000);
  if (((q?.units as number) ?? 0) > (Number(process.env.DAILY_QUOTA ?? 9500) - reserve)) return 0;
  if ((await storageStatus()).nearlyFull) return 0;
  // Videos without comments are done immediately.
  await db`update videos set comments_backfilled = true, comment_count_checked = 0,
      latest_comment_at = coalesce(latest_comment_at, published_at, (now() at time zone 'utc'))
    where not comments_backfilled and not comments_disabled and comment_count = 0
      and channel_id in (select id from channels where active)`;
  const parallel = Math.max(1, Number(process.env.LIVE_BACKFILL_PARALLEL ?? 4));
  const perVideo = Math.max(1, Math.ceil(maxPages / parallel));
  const videos = await db`
    select v.id, v.channel_id, v.comments_page_token, v.comment_count, v.latest_comment_at, v.published_at
    from videos v join channels c on c.id = v.channel_id
    where c.active and not v.comments_backfilled and not v.comments_disabled
    order by v.published_at desc nulls last limit ${parallel}`;
  const results = await Promise.all(videos.map((v) => backfillVideo(v, perVideo, timeLeft).catch((e) => {
    if (e instanceof QuotaExhausted) return 0;
    throw e;
  })));
  return results.reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ the live tick */
/** One run of the engine. Called every minute by an open browser tab ("browser") and
 *  every couple of minutes by an external timer ("cron"), so it also runs with the site closed. */
export async function liveTick(source: "browser" | "cron" = "browser"): Promise<TickResult> {
  const at = new Date().toISOString();
  const empty = { newComments: 0, newVideos: 0, labelled: 0, at };
  if (!youtubeConfigured()) return { status: "off", message: "Add YOUTUBE_API_KEY in Vercel to turn on live mode.", ...empty };
  await ensureLiveTable();
  const db = sql();
  const interval = Math.max(30, Number(process.env.LIVE_INTERVAL_SECONDS ?? 60) || 60);

  // Only one tick at a time across all open tabs/devices.
  const claimed = await db`
    update live_state set last_tick_at = (now() at time zone 'utc')
    where id = 1 and (last_tick_at is null or last_tick_at < (now() at time zone 'utc') - make_interval(secs => ${interval - 5}))
    returning id`;
  if (source === "cron") await db`update live_state set last_cron_at = (now() at time zone 'utc') where id = 1`;
  if (!claimed.length) return (await lastTick()) ?? { status: "skipped", ...empty };

  const started = Date.now();
  // Vercel's free plan includes 360 GB-hours of function memory a month. A run every 2 minutes
  // (720 a day) at 2 GB must average under ~25 s to fit with room for normal page views.
  const BUDGET_MS = Number(process.env.ENGINE_BUDGET_SECONDS ?? 22) * 1000;
  const deadline = started + BUDGET_MS;
  const timeLeft = () => Date.now() < deadline - 5000;
  const result: TickResult = { status: "ok", ...empty, source };
  const fresh: string[] = [];

  try {
    // 1. Channels added from other places (e.g. queued while quota was used up).
    const pending = await db`select id, query from channel_requests where status = 'pending' order by id limit 3`;
    for (const p of pending) {
      await db`delete from channel_requests where id = ${p.id}`;
      try {
        await addChannelNow(p.query as string);
      } catch (e) {
        // Keep the request (with the reason) instead of losing it.
        await db`insert into channel_requests (query, status, error, created_at)
          values (${p.query as string}, 'error', ${e instanceof Error ? e.message.slice(0, 300) : "failed"}, ${nowSql()})`;
        if (e instanceof QuotaExhausted) throw e;
      }
    }

    // 2. New uploads, every 10 minutes (1 quota unit per channel).
    const [st] = await db`select last_uploads_at from live_state where id = 1`;
    const uploadsDue = !st?.last_uploads_at || Date.now() - new Date(String(st.last_uploads_at).replace(" ", "T") + "Z").getTime() > 10 * 60000;
    if (uploadsDue) {
      await db`update live_state set last_uploads_at = (now() at time zone 'utc') where id = 1`;
      const chans = await db`select id, uploads_playlist_id from channels where active and uploads_playlist_id is not null`;
      for (const c of chans) {
        if (!timeLeft()) break;
        const page = await listUploads(c.uploads_playlist_id as string).catch(() => null);
        const ids = (page?.items ?? []).slice(0, 10).map((i) => i.contentDetails.videoId);
        if (!ids.length) continue;
        const known = new Set((await db`select id from videos where id in ${db(ids)}`).map((r) => r.id as string));
        const newIds = ids.filter((id) => !known.has(id));
        if (newIds.length) result.newVideos += (await saveVideos(c.id as string, await getVideos(newIds))).length;
      }
    }

    // 2b. Older videos: walk each channel's upload history, 2 pages (100 videos) per run,
    //     resuming where the last run (or the background job) stopped.
    const walking = await db`select id, uploads_playlist_id, videos_page_token from channels
      where active and not videos_backfilled and uploads_playlist_id is not null limit 2`;
    for (const c of walking) {
      let token = (c.videos_page_token as string | null) ?? undefined;
      for (let page = 0; page < 2 && timeLeft(); page++) {
        let data;
        try {
          data = await listUploads(c.uploads_playlist_id as string, token);
        } catch (e) {
          if (e instanceof YouTubeError && e.status === 400 && token) { // expired token: restart the walk
            await db`update channels set videos_page_token = null where id = ${c.id}`;
          }
          break;
        }
        const ids = (data.items ?? []).map((i) => i.contentDetails.videoId);
        if (ids.length) {
          const known = new Set((await db`select id from videos where id in ${db(ids)}`).map((r) => r.id as string));
          const newIds = ids.filter((id) => !known.has(id));
          if (newIds.length) await saveVideos(c.id as string, await getVideos(newIds));
        }
        token = data.nextPageToken;
        await db`update channels set videos_page_token = ${token ?? null}, videos_backfilled = ${!token} where id = ${c.id}`;
        if (!token) break;
      }
    }

    // 3. Fresh stats for recent videos (1 unit per 50 videos) to see which got new comments.
    const recent = await db`
      select v.id, v.channel_id from videos v join channels c on c.id = v.channel_id
      where c.active and not v.comments_disabled
        and v.published_at >= (now() at time zone 'utc') - make_interval(days => ${Number(process.env.LIVE_WINDOW_DAYS ?? 14)})
      order by v.published_at desc limit 100`;
    const byChannel = new Map(recent.map((r) => [r.id as string, r.channel_id as string]));
    if (recent.length) {
      const groups = new Map<string, VideoItem[]>();
      for (const v of await getVideos([...byChannel.keys()])) {
        const ch = byChannel.get(v.id)!;
        groups.set(ch, [...(groups.get(ch) ?? []), v]);
      }
      for (const [ch, items] of groups) await saveVideos(ch, items);
      // Views over time for recent videos (every 30 min at most) — feeds the performance prediction.
      await db`
        insert into video_snapshots (video_id, taken_at, view_count, like_count, comment_count)
        select v.id, (now() at time zone 'utc'), v.view_count, v.like_count, v.comment_count from videos v
        where v.id in ${db([...byChannel.keys()])}
          and not exists (select 1 from video_snapshots s where s.video_id = v.id
                          and s.taken_at >= (now() at time zone 'utc') - interval '30 minutes')`;
    }

    // 4. New comments wherever the count went up (newest videos first).
    const changed = await db`
      select v.id, v.channel_id, v.latest_comment_at from videos v join channels c on c.id = v.channel_id
      where c.active and not v.comments_disabled and v.comment_count > coalesce(v.comment_count_checked, -1)
        and (v.latest_comment_at is not null or v.published_at >= (now() at time zone 'utc') - interval '30 days')
      order by v.published_at desc nulls last limit 15`;
    for (const v of changed) {
      if (!timeLeft()) break;
      fresh.push(...(await fetchNewComments(v as never)));
    }
    result.newComments = fresh.length;

    // 5. Fill in comment history a few pages at a time (the background job does the same, faster).
    if (timeLeft()) result.backfilled = await backfillSome(Number(process.env.LIVE_BACKFILL_PAGES ?? 12), timeLeft);

  } catch (e) {
    // YouTube steps failed (e.g. today's quota is used up). The AI steps below don't use YouTube
    // quota, so they still run.
    if (e instanceof QuotaExhausted) { result.status = "quota"; result.message = e.message; }
    else { result.status = "error"; result.message = e instanceof Error ? e.message.slice(0, 300) : "Unknown error"; }
  }

  try {
    // 6. Let the AI read the new comments right away.
    if (fresh.length && timeLeft()) result.labelled = await labelComments(fresh.slice(0, 100), deadline).catch(() => 0);

    // 7. AI briefings get their own turn about every 10 minutes (a briefing takes ~10-15 s);
    // 8. otherwise the AI works through the backlog of comments it hasn't read yet.
    const everyMin = Math.max(1, Number(process.env.INSIGHTS_EVERY_MINUTES ?? 10));
    const insightsTurn = Math.floor(Date.now() / 60000) % everyMin < 2;
    if (insightsTurn && timeLeft()) result.insights = await writeDueInsights(deadline, 1).catch(() => 0);
    if (insightsTurn && timeLeft()) result.insights = (result.insights ?? 0) + (await writeDueIdeas(deadline).catch(() => 0));
    if (timeLeft()) result.aiBacklog = await labelBacklog(deadline, Number(process.env.AI_BACKLOG_PER_RUN ?? 150)).catch(() => 0);

    // 9. Alerts (new uploads, negative spikes, viral comments): checked on the same ~10-minute turn,
    //    since the checks aggregate recent comments.
    if (insightsTurn || result.newVideos) result.alerts = await checkAlerts().catch(() => 0);
  } catch (e) {
    if (result.status === "ok") { result.status = "error"; result.message = e instanceof Error ? e.message.slice(0, 300) : "Unknown error"; }
  }
  result.durationMs = Date.now() - started;
  await db`update live_state set last_result = ${JSON.stringify(result)} where id = 1`;
  return result;
}
