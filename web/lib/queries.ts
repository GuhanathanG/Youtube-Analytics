import "server-only";
import { sql } from "./db";
import { cached } from "./cache";
import { ensureSummary, summaries } from "./summary";
import { archiveConfigured, searchArchive } from "./archive";

import { ASPECT_LABELS, EMOTIONS, languageName } from "./queries-shared";
export { ASPECT_LABELS, EMOTIONS, LANGUAGE_NAMES, languageName } from "./queries-shared";

export function quotaDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
}

/* ------------------------------------------------------------------ filters */
export type Filters = {
  channelId?: string | null;
  videoId?: string | null;
  since?: Date | null;
  sentiment?: string | null;
  language?: string | null;
  emotion?: string | null;
  flag?: "question" | "suggestion" | "spam" | "toxic" | null;
  search?: string | null;
  hideSpam?: boolean;
  topLevelOnly?: boolean;
};

const FLAG_COLUMNS = { question: "is_question", suggestion: "is_suggestion", spam: "is_spam", toxic: "is_toxic" } as const;

function where(f: Filters) {
  const db = sql();
  const parts = [db`true`];
  if (f.channelId) parts.push(db`c.channel_id = ${f.channelId}`);
  if (f.videoId) parts.push(db`c.video_id = ${f.videoId}`);
  if (f.since) parts.push(db`c.published_at >= ${f.since.toISOString().slice(0, 19)}`);
  if (f.sentiment) parts.push(db`c.sentiment = ${f.sentiment}`);
  if (f.language) parts.push(db`c.language = ${f.language}`);
  if (f.emotion) parts.push(db`c.emotion = ${f.emotion}`);
  if (f.flag && FLAG_COLUMNS[f.flag]) parts.push(db`${db(FLAG_COLUMNS[f.flag])} = true`);
  if (f.hideSpam) parts.push(db`(c.is_spam is null or c.is_spam = false)`);
  if (f.topLevelOnly) parts.push(db`c.parent_id is null`);
  if (f.search) parts.push(db`c.text ilike ${"%" + f.search.replace(/[%_]/g, "\\$&") + "%"}`);
  return parts.reduce((acc, p, i) => (i === 0 ? p : db`${acc} and ${p}`));
}

/* ------------------------------------------------------------------ overview */
export type Kpis = {
  channels: number; videos: number; comments: number; analyzed: number; ai_read: number;
  videos_backfilling: number; last_fetch: string | null; quota_used_today: number;
  comments_24h: number;
};

export async function kpis(): Promise<Kpis> {
  return cached("kpis", 30000, kpisUncached);
}

async function kpisUncached(): Promise<Kpis> {
  const db = sql();
  const sums = await summaries();
  const [row] = await db`
    select
      (select count(*) from channels where active)::int as channels,
      (select count(*) from videos)::int as videos,
      (select count(*) from videos where not comments_backfilled and not comments_disabled)::int as videos_backfilling,
      coalesce((select units from quota_usage where day = ${quotaDay()}), 0)::int as quota_used_today`;
  let comments = 0, analyzed = 0, ai_read = 0, comments_24h = 0, last_fetch: string | null = null;
  for (const x of sums.values()) {
    comments += x.comments; analyzed += x.analyzed; ai_read += x.ai_read; comments_24h += x.comments_24h;
    if (x.last_fetch && (!last_fetch || x.last_fetch > last_fetch)) last_fetch = x.last_fetch;
  }
  return { ...(row as unknown as Kpis), comments, analyzed, ai_read, comments_24h, last_fetch };
}

export type ChannelRow = {
  id: string; title: string; handle: string | null; thumbnail_url: string | null; description: string | null;
  subscriber_count: number | null; view_count: number | null; video_count: number | null; active: boolean;
  last_synced_at: string | null; videos_stored: number; videos_backfilled: number; comments: number;
  positive: number; neutral: number; negative: number; avg_sentiment: number | null;
};

export async function channels(): Promise<ChannelRow[]> {
  return cached("channels", 30000, channelsUncached);
}

async function channelsUncached(): Promise<ChannelRow[]> {
  const db = sql();
  await ensureSummary();
  return (await db`
    select ch.id, ch.title, ch.handle, ch.thumbnail_url, ch.description,
           ch.subscriber_count::float8 as subscriber_count, ch.view_count::float8 as view_count,
           ch.video_count::int as video_count, ch.active, ch.last_synced_at,
           coalesce(v.n, 0)::int as videos_stored, coalesce(v.done, 0)::int as videos_backfilled,
           coalesce(c.comments, 0)::int as comments, coalesce(c.positive, 0)::int as positive,
           coalesce(c.neutral, 0)::int as neutral, coalesce(c.negative, 0)::int as negative,
           c.avg_sentiment::float8 as avg_sentiment
    from channels ch
    left join (select channel_id, count(*) n, sum(case when comments_backfilled then 1 else 0 end) done
               from videos group by channel_id) v on v.channel_id = ch.id
    left join channel_summary c on c.channel_id = ch.id
    order by ch.subscriber_count desc nulls last, ch.title`) as unknown as ChannelRow[];
}

export async function channel(id: string): Promise<ChannelRow | null> {
  // Always fresh (not cached), so a channel added moments ago opens straight away.
  return (await channelsUncached()).find((c) => c.id === id) ?? null;
}

export type VideoRow = {
  id: string; channel_id: string; title: string; published_at: string | null; thumbnail_url: string | null;
  duration: string | null; view_count: number | null; like_count: number | null; comments_on_youtube: number | null;
  comments_disabled: boolean; comments_backfilled: boolean; comments_stored: number; positive: number;
  neutral: number; negative: number; avg_sentiment: number | null; channel_title?: string;
};

export async function videos(channelId: string): Promise<VideoRow[]> {
  const db = sql();
  return (await db`
    select v.id, v.channel_id, v.title, v.published_at, v.thumbnail_url, v.duration,
           v.view_count::float8 as view_count, v.like_count::float8 as like_count,
           v.comment_count::int as comments_on_youtube, v.comments_disabled, v.comments_backfilled,
           coalesce(c.n, 0)::int as comments_stored, coalesce(c.pos, 0)::int as positive,
           coalesce(c.neu, 0)::int as neutral, coalesce(c.neg, 0)::int as negative, c.avg_s::float8 as avg_sentiment
    from videos v
    left join (select video_id, count(*) n,
                      sum(case when sentiment = 'positive' then 1 else 0 end) pos,
                      sum(case when sentiment = 'neutral' then 1 else 0 end) neu,
                      sum(case when sentiment = 'negative' then 1 else 0 end) neg,
                      avg(sentiment_value) avg_s
               from comments where channel_id = ${channelId} group by video_id) c on c.video_id = v.id
    where v.channel_id = ${channelId}
    order by v.published_at desc nulls last`) as unknown as VideoRow[];
}

export async function video(id: string): Promise<VideoRow | null> {
  const db = sql();
  const [v] = await db`select channel_id from videos where id = ${id}`;
  if (!v) return null;
  const list = await videos(v.channel_id as string);
  const row = list.find((x) => x.id === id) ?? null;
  if (row) {
    const [ch] = await db`select title from channels where id = ${v.channel_id}`;
    row.channel_title = (ch?.title as string) ?? "";
  }
  return row;
}

/* ------------------------------------------------------------------ comment aggregates */
export type DailyRow = { day: string; positive: number; neutral: number; negative: number; pending: number };

export async function dailySentiment(f: Filters): Promise<DailyRow[]> {
  const db = sql();
  // Archived days (counts kept in archive_stats) are added when the filter is only channel and/or date.
  let archived: Record<string, unknown>[] = [];
  if (!f.videoId && !f.sentiment && !f.language && !f.emotion && !f.flag && !f.search && !f.topLevelOnly) {
    archived = await db`select to_char(day, 'YYYY-MM-DD') as day, sum(positive)::int as positive, sum(neutral)::int as neutral,
        sum(negative)::int as negative, sum(comments - positive - neutral - negative)::int as pending
      from archive_stats where ${f.channelId ? db`channel_id = ${f.channelId}` : db`true`}
        and ${f.since ? db`day >= ${f.since.toISOString().slice(0, 10)}::date` : db`true`}
      group by 1`.catch(() => []);
  }
  const rows = await db`
    select to_char(date(c.published_at), 'YYYY-MM-DD') as day,
           sum(case when c.sentiment = 'positive' then 1 else 0 end)::int as positive,
           sum(case when c.sentiment = 'neutral' then 1 else 0 end)::int as neutral,
           sum(case when c.sentiment = 'negative' then 1 else 0 end)::int as negative,
           sum(case when c.sentiment is null then 1 else 0 end)::int as pending
    from comments c where ${where(f)} and c.published_at is not null
    group by 1 order by 1`;
  if (!archived.length) return rows as unknown as DailyRow[];
  const byDay = new Map<string, DailyRow>();
  for (const r of [...rows, ...archived] as unknown as DailyRow[]) {
    const d = byDay.get(r.day) ?? { ...r, positive: 0, neutral: 0, negative: 0, pending: 0 };
    d.positive += r.positive; d.neutral += r.neutral; d.negative += r.negative; d.pending += r.pending;
    byDay.set(r.day, d);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export type Mix = { positive: number; neutral: number; negative: number; pending: number };

/** True when the filter is "this channel, all time" (or everything): the summary already has the answer. */
const summaryOnly = (f: Filters) => !f.videoId && !f.since && !f.sentiment && !f.language && !f.emotion && !f.flag && !f.search && !f.topLevelOnly;

export async function sentimentMix(f: Filters): Promise<Mix> {
  if (f.channelId && summaryOnly(f)) {
    const x = (await summaries()).get(f.channelId);
    if (x) return { positive: x.positive, neutral: x.neutral, negative: x.negative, pending: Math.max(0, x.comments - x.positive - x.neutral - x.negative) };
  }
  const db = sql();
  const [r] = await db`
    select sum(case when c.sentiment = 'positive' then 1 else 0 end)::int as positive,
           sum(case when c.sentiment = 'neutral' then 1 else 0 end)::int as neutral,
           sum(case when c.sentiment = 'negative' then 1 else 0 end)::int as negative,
           sum(case when c.sentiment is null then 1 else 0 end)::int as pending
    from comments c where ${where(f)}`;
  return { positive: r?.positive ?? 0, neutral: r?.neutral ?? 0, negative: r?.negative ?? 0, pending: r?.pending ?? 0 };
}

export async function languageCounts(f: Filters) {
  if (f.channelId && summaryOnly(f)) {
    const x = (await summaries()).get(f.channelId);
    if (x) return x.languages.map((l) => ({ code: l.code, name: languageName(l.code), comments: l.comments, avg: l.avg }));
  }
  const db = sql();
  const rows = await db`
    select c.language, count(*)::int as comments, avg(c.sentiment_value)::float8 as avg_sentiment
    from comments c where ${where(f)} and c.analyzed_at is not null
    group by c.language order by count(*) desc`;
  return rows.map((r) => ({ code: r.language as string, name: languageName(r.language as string),
    comments: r.comments as number, avg: r.avg_sentiment as number | null }));
}

export async function emotionCounts(f: Filters) {
  if (f.channelId && summaryOnly(f)) {
    const x = (await summaries()).get(f.channelId);
    if (x) return x.emotions.map((e) => ({ emotion: e.emotion, icon: EMOTIONS[e.emotion] ?? "", comments: e.comments }));
  }
  const db = sql();
  const rows = await db`
    select c.emotion, count(*)::int as comments from comments c
    where ${where(f)} and c.emotion is not null group by c.emotion order by count(*) desc`;
  return rows.map((r) => ({ emotion: r.emotion as string, icon: EMOTIONS[r.emotion as string] ?? "", comments: r.comments as number }));
}

export async function aspectCounts(f: Filters) {
  const db = sql();
  const sums = Object.keys(ASPECT_LABELS).flatMap((a) =>
    (["pos", "neg"] as const).map((p) =>
      db`sum(case when c.aspects like ${"%" + a + ":" + p + "%"} then 1 else 0 end)::int as ${db(a + "__" + p)}`));
  const select = sums.reduce((acc, s, i) => (i === 0 ? s : db`${acc}, ${s}`));
  const [r] = await db`select ${select} from comments c where ${where(f)} and c.aspects is not null`;
  return Object.entries(ASPECT_LABELS)
    .map(([key, label]) => ({ key, label, positive: (r?.[key + "__pos"] as number) ?? 0, negative: (r?.[key + "__neg"] as number) ?? 0 }))
    .filter((x) => x.positive + x.negative > 0)
    .sort((a, b) => b.positive + b.negative - (a.positive + a.negative));
}

export type CommentRow = {
  id: string; video_id: string; video_title: string; channel_title: string; published_at: string | null;
  author_name: string | null; text: string; translation: string | null; like_count: number; reply_count: number;
  sentiment: string | null; sentiment_value: number | null; sentiment_source: string | null; emotion: string | null;
  language: string | null; is_question: boolean | null; is_suggestion: boolean | null; is_spam: boolean | null;
  is_reply: boolean; aspects: string | null; channel_id?: string; author_channel_id?: string | null;
};

export type CommentOrder = "newest" | "oldest" | "most_liked" | "most_negative" | "most_positive";

export async function comments(f: Filters, order: CommentOrder = "newest", limit = 200): Promise<CommentRow[]> {
  const db = sql();
  const orderSql = {
    newest: db`c.published_at desc nulls last`,
    oldest: db`c.published_at asc nulls last`,
    most_liked: db`c.like_count desc, c.published_at desc`,
    most_negative: db`c.sentiment_value asc`,
    most_positive: db`c.sentiment_value desc`,
  }[order];
  const extra = order === "most_negative" || order === "most_positive" ? db`and c.sentiment_value is not null` : db``;
  const live = (await db`
    select c.id, c.video_id, v.title as video_title, ch.title as channel_title, c.channel_id, c.author_channel_id, c.published_at, c.author_name,
           c.text, c.translation, c.like_count, c.reply_count, c.sentiment, c.sentiment_value::float8 as sentiment_value,
           c.sentiment_source, c.emotion, c.language, c.is_question, c.is_suggestion, c.is_spam,
           (c.parent_id is not null) as is_reply, c.aspects
    from comments c join videos v on v.id = c.video_id join channels ch on ch.id = c.channel_id
    where ${where(f)} ${extra}
    order by ${orderSql}
    limit ${Math.min(limit, 5000)}`) as unknown as CommentRow[];
  // A text search also looks in the comment archive (old comments moved out of the main database).
  if (!f.search || !archiveConfigured() || f.videoId || f.sentiment || f.language || f.emotion || f.flag) return live;
  const old = (await searchArchive([f.search], f.channelId ?? null, Math.min(limit, 200))) as unknown as CommentRow[];
  if (!old.length) return live;
  const key = (c: CommentRow) => (order === "most_liked" ? c.like_count : Date.parse(String(c.published_at ?? 0)) * (order === "oldest" ? -1 : 1));
  const seen = new Set(live.map((c) => c.id));
  return [...live, ...old.filter((c) => !seen.has(c.id))].sort((a, b) => key(b) - key(a)).slice(0, Math.min(limit, 5000));
}

/* ------------------------------------------------------------------ growth, insights, ops */
export async function channelSnapshots(id: string) {
  const db = sql();
  return (await db`
    select to_char(date(taken_at), 'YYYY-MM-DD') as day,
           max(subscriber_count)::float8 as subscribers, max(view_count)::float8 as views
    from channel_snapshots where channel_id = ${id} group by 1 order by 1`) as unknown as
    { day: string; subscribers: number | null; views: number | null }[];
}

export async function videoSnapshots(id: string) {
  const db = sql();
  return (await db`
    select to_char(taken_at, 'YYYY-MM-DD HH24:MI') as at, view_count::float8 as views,
           like_count::float8 as likes, comment_count::float8 as comments
    from video_snapshots where video_id = ${id} order by taken_at`) as unknown as
    { at: string; views: number | null; likes: number | null; comments: number | null }[];
}

export type Insight = { data: Record<string, unknown>; created_at: string; comment_count: number; model: string | null };

export async function latestInsight(scope: "video" | "channel" | "ideas", id: string): Promise<Insight | null> {
  const db = sql();
  const [r] = await db`
    select data, created_at, comment_count, model from insights
    where scope = ${scope} and target_id = ${id} order by created_at desc limit 1`;
  if (!r) return null;
  try {
    return { data: JSON.parse(r.data as string), created_at: r.created_at as string,
      comment_count: r.comment_count as number, model: r.model as string | null };
  } catch {
    return null;
  }
}

export async function recentInsights(limit = 6) {
  const db = sql();
  const rows = await db`
    select i.scope, i.target_id, i.created_at, i.data,
           coalesce(v.title, ch.title) as title
    from insights i
    left join videos v on i.scope = 'video' and v.id = i.target_id
    left join channels ch on i.scope = 'channel' and ch.id = i.target_id
    order by i.created_at desc limit ${limit}`;
  return rows.map((r) => {
    let summary = "";
    try { summary = (JSON.parse(r.data as string).summary as string) ?? ""; } catch { /* ignore */ }
    return { scope: r.scope as string, id: r.target_id as string, title: (r.title as string) ?? "", created_at: r.created_at as string, summary };
  });
}

export async function lastRuns(limit = 15) {
  const db = sql();
  return (await db`
    select kind, started_at, finished_at, status, summary from run_log
    where kind <> 'job' order by started_at desc limit ${limit}`) as unknown as
    { kind: string; started_at: string; finished_at: string | null; status: string; summary: string | null }[];
}

export async function lastSyncAt(): Promise<string | null> {
  const db = sql();
  const [r] = await db`select max(finished_at) as t from run_log where kind = 'sync' and status = 'ok'`;
  return (r?.t as string) ?? null;
}

export async function channelRequests() {
  const db = sql();
  return (await db`select id, query, status, error, created_at from channel_requests order by created_at desc limit 30`) as unknown as
    { id: number; query: string; status: string; error: string | null; created_at: string }[];
}

export async function llmUsageToday() {
  const db = sql();
  return (await db`
    select model_key, requests, tokens, exhausted, last_error from llm_usage
    where day = ${quotaDay()} order by model_key`) as unknown as
    { model_key: string; requests: number; tokens: number; exhausted: boolean; last_error: string | null }[];
}

export async function actionsMinutesThisMonth(): Promise<number> {
  const db = sql();
  const [r] = await db`
    select coalesce(sum(greatest(1, ceil(extract(epoch from (finished_at - started_at)) / 60))), 0)::int as m
    from run_log where kind = 'job' and finished_at is not null
      and started_at >= date_trunc('month', now() at time zone 'utc')`;
  return (r?.m as number) ?? 0;
}

export async function searchEverything(q: string) {
  const db = sql();
  const like = "%" + q.replace(/[%_]/g, "\\$&") + "%";
  const chans = await db`
    select id, title, handle, thumbnail_url from channels
    where title ilike ${like} or coalesce(handle, '') ilike ${like} order by title limit 6`;
  const vids = await db`
    select v.id, v.title, v.thumbnail_url, ch.title as channel_title from videos v join channels ch on ch.id = v.channel_id
    where v.title ilike ${like} order by v.published_at desc nulls last limit 10`;
  return {
    channels: chans.map((c) => ({ id: c.id as string, title: c.title as string, handle: c.handle as string | null, thumb: c.thumbnail_url as string | null })),
    videos: vids.map((v) => ({ id: v.id as string, title: v.title as string, channel: v.channel_title as string, thumb: v.thumbnail_url as string | null })),
  };
}


export type Progress = {
  channel_id: string; title: string; videos_total: number | null; videos_known: number; videos_complete: number;
  comments_on_youtube: number; comments_stored: number; ai_read: number;
  saved_last_hour: number; ai_last_hour: number;
  sentiment_done: number; sentiment_last_hour: number;
  // Slower AI jobs (filled in by jobExtras; null when that job's table doesn't exist yet)
  videos_to_watch?: number | null; thumbs_to_check?: number | null; months_to_remember?: number | null;
  watch_per_hour?: number; thumbs_per_hour?: number; memory_per_hour?: number;
};

/** History download and AI progress per channel, with recent speed for an ETA. */
export async function progress(): Promise<Progress[]> {
  return cached("progress", 30000, progressUncached);
}

async function progressUncached(): Promise<Progress[]> {
  const db = sql();
  await ensureSummary();
  const rows = (await db`
    select ch.id as channel_id, ch.title, ch.video_count::int as videos_total,
      coalesce(v.known, 0)::int as videos_known, coalesce(v.complete, 0)::int as videos_complete,
      coalesce(v.on_yt, 0)::float8 as comments_on_youtube,
      coalesce(c.comments, 0)::int as comments_stored, coalesce(c.ai_read, 0)::int as ai_read,
      coalesce(c.saved_hour, 0)::int as saved_last_hour, coalesce(c.ai_hour, 0)::int as ai_last_hour,
      coalesce(c.analyzed, 0)::int as sentiment_done, coalesce(c.sentiment_hour, 0)::int as sentiment_last_hour
    from channels ch
    left join (select channel_id, count(*) known, sum(case when comments_backfilled or comments_disabled then 1 else 0 end) complete,
                      sum(case when comments_disabled then 0 else coalesce(comment_count, 0) end) on_yt
               from videos group by channel_id) v on v.channel_id = ch.id
    left join channel_summary c on c.channel_id = ch.id
    where ch.active order by ch.title`) as unknown as Progress[];
  const extra = await cached("job-extras", 10 * 60_000, jobExtras).catch(() => null);
  if (extra) for (const r of rows) Object.assign(r, extra.perChannel.get(r.channel_id) ?? {}, extra.rates);
  return rows;
}

/** Remaining work and speed of the slower AI jobs (video watching, thumbnails, Creator Memory). */
async function jobExtras() {
  const db = sql();
  const perChannel = new Map<string, Partial<Progress>>();
  const rates = { watch_per_hour: 0.5, thumbs_per_hour: 12.5, memory_per_hour: 6 }; // designed pace, replaced by measured speed below
  const safe = async <T,>(p: Promise<T>) => { try { return await p; } catch { return null; } };
  const watch = await safe(db`select v.channel_id, count(*)::int as n from videos v join channels c on c.id = v.channel_id
    left join video_analysis a on a.video_id = v.id where c.active and a.video_id is null
      and v.published_at >= (now() at time zone 'utc') - interval '30 days' group by 1`);
  const thumbs = await safe(db`select v.channel_id, count(*)::int as n from videos v join channels c on c.id = v.channel_id
    left join thumb_analysis t on t.video_id = v.id where c.active and v.thumbnail_url is not null and t.video_id is null group by 1`);
  const months = await safe(db`
    with m as (select c.channel_id, to_char(date_trunc('month', c.published_at), 'YYYY-MM') as mon from comments c
               where c.published_at >= date_trunc('month', (now() at time zone 'utc')) - interval '23 months'
               group by 1, 2 having count(*) >= 20)
    select m.channel_id, count(*)::int as n from m
    where not exists (select 1 from insights i where i.scope = 'month' and i.target_id = m.channel_id || ':' || m.mon) group by 1`);
  for (const [rows, key] of [[watch, "videos_to_watch"], [thumbs, "thumbs_to_check"], [months, "months_to_remember"]] as const) {
    if (!rows) continue;
    for (const r of rows) perChannel.set(r.channel_id as string, { ...(perChannel.get(r.channel_id as string) ?? {}), [key]: r.n as number });
  }
  const [speed] = await db`select
      (select count(*) from insights where scope = 'month' and created_at >= (now() at time zone 'utc') - interval '24 hours')::float8 / 24 as memory,
      (select count(*) from insights where scope = 'month' and created_at >= (now() at time zone 'utc') - interval '24 hours') as memory_n`;
  if ((speed?.memory_n as number) >= 3) rates.memory_per_hour = speed.memory as number;
  const w = await safe(db`select count(*)::int as n from video_analysis where status = 'done' and created_at >= (now() at time zone 'utc') - interval '24 hours'`);
  if (w && (w[0].n as number) >= 2) rates.watch_per_hour = (w[0].n as number) / 24;
  const t = await safe(db`select count(*)::int as n from thumb_analysis where status = 'done' and created_at >= (now() at time zone 'utc') - interval '24 hours'`);
  if (t && (t[0].n as number) >= 5) rates.thumbs_per_hour = (t[0].n as number) / 24;
  return { perChannel, rates };
}
