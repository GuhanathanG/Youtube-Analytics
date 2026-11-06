import "server-only";
import { sql, ensureRls, ensureIndex } from "./db";
import { archivedTotals } from "./archive";

/**
 * Pre-calculated totals per channel (comment counts, sentiment mix, AI progress, languages,
 * emotions). Counting every stored comment on each page view is too slow once there are
 * hundreds of thousands of comments, so the 2-minute engine refreshes one channel's summary per
 * run (each at most every few minutes) and pages read these small rows instead.
 */
export type ChannelSummary = {
  channel_id: string; updated_at: string; comments: number; analyzed: number; ai_read: number;
  positive: number; neutral: number; negative: number; avg_sentiment: number | null;
  saved_hour: number; ai_hour: number; sentiment_hour: number; comments_24h: number; last_fetch: string | null;
  languages: { code: string; comments: number; avg: number | null }[]; emotions: { emotion: string; comments: number }[];
};

let ready = false;
export async function ensureSummary() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists channel_summary (
    channel_id text primary key, updated_at timestamp not null, comments integer not null default 0, analyzed integer not null default 0,
    ai_read integer not null default 0, positive integer not null default 0, neutral integer not null default 0, negative integer not null default 0,
    avg_sentiment double precision, saved_hour integer not null default 0, ai_hour integer not null default 0, sentiment_hour integer not null default 0,
    comments_24h integer not null default 0, last_fetch timestamp, languages text, emotions text)`;
  await ensureRls("channel_summary");
  // Per-video totals, refreshed with the channel's summary (pages and the AI briefing check read these).
  await db`create table if not exists video_summary (video_id text primary key, channel_id text not null, comments integer not null,
    positive integer not null, neutral integer not null, negative integer not null, avg_sentiment double precision)`;
  await ensureIndex("ix_video_summary_channel", "create index if not exists ix_video_summary_channel on video_summary (channel_id)");
  await ensureRls("video_summary");
  ready = true;
}

/** Recount one channel (three scans of that channel's comments, using the channel index). */
export async function refreshSummary(channelId: string) {
  await ensureSummary();
  const db = sql();
  const [r] = await db`
    select count(*)::int as comments, count(analyzed_at)::int as analyzed, count(ai_at)::int as ai_read,
      count(*) filter (where sentiment = 'positive')::int as positive, count(*) filter (where sentiment = 'neutral')::int as neutral,
      count(*) filter (where sentiment = 'negative')::int as negative, avg(sentiment_value)::float8 as avg_sentiment,
      count(*) filter (where fetched_at >= (now() at time zone 'utc') - interval '1 hour')::int as saved_hour,
      count(*) filter (where ai_at >= (now() at time zone 'utc') - interval '1 hour')::int as ai_hour,
      count(*) filter (where analyzed_at >= (now() at time zone 'utc') - interval '1 hour')::int as sentiment_hour,
      count(*) filter (where published_at >= (now() at time zone 'utc') - interval '24 hours')::int as comments_24h,
      max(fetched_at) as last_fetch
    from comments where channel_id = ${channelId}`;
  const langs = await db`select language as code, count(*)::int as comments, avg(sentiment_value)::float8 as avg
    from comments where channel_id = ${channelId} and analyzed_at is not null group by 1 order by 2 desc limit 12`;
  const emos = await db`select emotion, count(*)::int as comments from comments
    where channel_id = ${channelId} and emotion is not null group by 1 order by 2 desc limit 16`;
  await db`insert into video_summary (video_id, channel_id, comments, positive, neutral, negative, avg_sentiment)
    select video_id, ${channelId}, count(*)::int, count(*) filter (where sentiment = 'positive')::int,
      count(*) filter (where sentiment = 'neutral')::int, count(*) filter (where sentiment = 'negative')::int, avg(sentiment_value)::float8
    from comments where channel_id = ${channelId} group by video_id
    on conflict (video_id) do update set comments = excluded.comments, positive = excluded.positive, neutral = excluded.neutral,
      negative = excluded.negative, avg_sentiment = excluded.avg_sentiment`;
  // Comments moved to the archive still count (their totals are kept in archive_stats).
  const ar = await archivedTotals(channelId);
  if (ar && ar.comments) {
    const liveN = Number(r.comments) || 0;
    const liveAvg = r.avg_sentiment === null ? null : Number(r.avg_sentiment);
    const n = (liveAvg === null ? 0 : liveN) + ar.sentiment_n;
    r.avg_sentiment = n ? (((liveAvg ?? 0) * (liveAvg === null ? 0 : liveN)) + ar.sentiment_sum) / n : null;
    for (const k of ["comments", "positive", "neutral", "negative", "analyzed", "ai_read"] as const) r[k] = (Number(r[k]) || 0) + ar[k];
  }
  await db`insert into channel_summary ${db({ channel_id: channelId, updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      ...r, languages: JSON.stringify(langs), emotions: JSON.stringify(emos) } as Record<string, unknown>)}
    on conflict (channel_id) do update set updated_at = excluded.updated_at, comments = excluded.comments, analyzed = excluded.analyzed,
      ai_read = excluded.ai_read, positive = excluded.positive, neutral = excluded.neutral, negative = excluded.negative,
      avg_sentiment = excluded.avg_sentiment, saved_hour = excluded.saved_hour, ai_hour = excluded.ai_hour,
      sentiment_hour = excluded.sentiment_hour, comments_24h = excluded.comments_24h, last_fetch = excluded.last_fetch,
      languages = excluded.languages, emotions = excluded.emotions`;
}

/** Engine step: refresh the stalest channel summary if it's older than SUMMARY_EVERY_MINUTES (default 3). */
export async function refreshDueSummaries(timeLeft: () => boolean, max = 1): Promise<number> {
  await ensureSummary();
  const every = Number(process.env.SUMMARY_EVERY_MINUTES ?? 10);
  const due = await sql()`select ch.id from channels ch left join channel_summary s on s.channel_id = ch.id
    where ch.active and (s.updated_at is null or s.updated_at < (now() at time zone 'utc') - make_interval(mins => ${every}))
    order by s.updated_at asc nulls first limit ${max}`;
  let n = 0;
  for (const c of due) {
    if (!timeLeft()) break;
    await refreshSummary(c.id as string);
    n++;
  }
  return n;
}

export async function summaries(): Promise<Map<string, ChannelSummary>> {
  try {
    await ensureSummary();
    const rows = await sql()`select * from channel_summary`;
    const parse = <T,>(s: unknown, d: T): T => { try { return s ? (JSON.parse(String(s)) as T) : d; } catch { return d; } };
    return new Map(rows.map((r) => [r.channel_id as string, { ...(r as unknown as ChannelSummary),
      languages: parse(r.languages, []), emotions: parse(r.emotions, []) }]));
  } catch {
    return new Map();
  }
}
