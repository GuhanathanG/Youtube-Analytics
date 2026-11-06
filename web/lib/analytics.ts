import "server-only";
import { cached } from "./cache";
import { sql } from "./db";
import {
  LENGTH_BUCKETS, TITLE_FEATURES, durationSeconds, forecastViews, isShort, median, titleWords,
} from "./analytics-math";

/**
 * Advanced analytics, calculated from stored data (no AI quota). Results are cached for
 * 10 minutes per server copy because they scan every video and many comments.
 */
const TTL = 10 * 60_000;
export const TIMEZONE = process.env.DISPLAY_TIMEZONE ?? "Asia/Kolkata";

export type VideoPerf = {
  id: string; title: string; thumbnail_url: string | null; published_at: string | null;
  views: number; likes: number; comments: number; seconds: number | null; short: boolean; ageDays: number;
  outlier: number | null; likeRate: number | null; commentRate: number | null;
};
type Group = { count: number; medianViews: number | null; medianLikeRate: number | null; medianCommentRate: number | null; medianOutlier: number | null };
export type Cell = { count: number; outlier: number | null };

export type ChannelAnalytics = {
  videos: VideoPerf[];
  formats: { shorts: Group; long: Group };
  top: VideoPerf[]; bottom: VideoPerf[];
  early: { median24: number | null; median48: number | null; videos: { id: string; title: string; views24: number; ratio: number | null }[] };
  heatmap: { days: string[]; blocks: string[]; cells: Cell[][]; best: { day: string; block: string; outlier: number; count: number } | null };
  titleFeatures: { label: string; with: number; without: number; withOutlier: number | null; withoutOutlier: number | null; lift: number | null }[];
  titleWords: { word: string; count: number; outlier: number }[];
  lengths: { label: string; count: number; medianViews: number | null; outlier: number | null }[];
  timezone: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCKS = ["0–3", "3–6", "6–9", "9–12", "12–15", "15–18", "18–21", "21–24"];

function group(vs: VideoPerf[]): Group {
  return {
    count: vs.length,
    medianViews: median(vs.map((v) => v.views)),
    medianLikeRate: median(vs.filter((v) => v.views).map((v) => v.likes / v.views)),
    medianCommentRate: median(vs.filter((v) => v.views).map((v) => v.comments / v.views)),
    medianOutlier: median(vs.flatMap((v) => (v.outlier === null ? [] : [v.outlier]))),
  };
}

function dayHour(iso: string, tz: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  return { day: DAYS.indexOf(wd), hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24 };
}

export function channelAnalytics(channelId: string): Promise<ChannelAnalytics> {
  return cached(`analytics:${channelId}`, TTL, () => computeChannel(channelId));
}

async function computeChannel(channelId: string): Promise<ChannelAnalytics> {
  const db = sql();
  const rows = await db`
    select id, title, thumbnail_url, published_at, duration,
      coalesce(view_count, 0)::float8 as views, coalesce(like_count, 0)::float8 as likes, coalesce(comment_count, 0)::float8 as comments,
      extract(epoch from ((now() at time zone 'utc') - published_at)) / 86400 as age
    from videos where channel_id = ${channelId} and published_at is not null
    order by published_at desc limit 3000`;
  const videos: VideoPerf[] = rows.map((r) => {
    const seconds = durationSeconds(r.duration as string);
    const views = r.views as number;
    return {
      id: r.id as string, title: String(r.title ?? ""), thumbnail_url: (r.thumbnail_url as string) ?? null,
      published_at: r.published_at ? new Date(r.published_at as string).toISOString() : null,
      views, likes: r.likes as number, comments: r.comments as number, seconds, short: isShort(seconds),
      ageDays: Number(r.age ?? 0), outlier: null,
      likeRate: views ? (r.likes as number) / views : null, commentRate: views ? (r.comments as number) / views : null,
    };
  });

  // Outlier score: views ÷ the channel's typical (median) views for the same format, from the last
  // year's videos that are at least 3 days old. 1.0 = typical, 3.0 = three times the usual.
  const settled = videos.filter((v) => v.ageDays >= 3 && v.ageDays <= 365);
  const base = {
    short: median(settled.filter((v) => v.short).map((v) => v.views)),
    long: median(settled.filter((v) => !v.short).map((v) => v.views)),
    all: median(settled.map((v) => v.views)),
  };
  const enough = { short: settled.filter((v) => v.short).length >= 5, long: settled.filter((v) => !v.short).length >= 5 };
  for (const v of videos) {
    if (v.ageDays < 3) continue;
    const b = v.short ? (enough.short ? base.short : base.all) : (enough.long ? base.long : base.all);
    v.outlier = b ? v.views / b : null;
  }
  const scored = videos.filter((v) => v.outlier !== null && v.ageDays <= 365);
  const byOutlier = [...scored].sort((a, b) => b.outlier! - a.outlier!);

  // Early growth: views about 24 h and 48 h after upload, from the stored snapshots.
  const snaps = await db`
    select s.video_id, extract(epoch from (s.taken_at - v.published_at)) / 3600 as hours, s.view_count::float8 as views
    from video_snapshots s join videos v on v.id = s.video_id
    where v.channel_id = ${channelId} and v.published_at >= (now() at time zone 'utc') - interval '180 days'
      and s.taken_at between v.published_at + interval '16 hours' and v.published_at + interval '58 hours'`;
  const near = (vid: string, target: number, tol: number) => {
    let best: { d: number; views: number } | null = null;
    for (const s of snaps) {
      if (s.video_id !== vid) continue;
      const d = Math.abs((s.hours as number) - target);
      if (d <= tol && (!best || d < best.d)) best = { d, views: s.views as number };
    }
    return best?.views ?? null;
  };
  const vids = [...new Set(snaps.map((s) => s.video_id as string))];
  const at24 = vids.map((id) => ({ id, v: near(id, 24, 6) })).filter((x) => x.v !== null) as { id: string; v: number }[];
  const at48 = vids.map((id) => near(id, 48, 8)).filter((x): x is number => x !== null);
  const median24 = median(at24.map((x) => x.v));
  const earlyVideos = at24.map((x) => ({ id: x.id, title: videos.find((v) => v.id === x.id)?.title ?? x.id, views24: x.v,
    ratio: median24 ? x.v / median24 : null })).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, 8);

  // Best upload time: day × 3-hour block (viewer's time zone) vs the median outlier score.
  const buckets: number[][][] = DAYS.map(() => BLOCKS.map(() => []));
  for (const v of scored) {
    if (!v.published_at) continue;
    const { day, hour } = dayHour(v.published_at, TIMEZONE);
    if (day >= 0) buckets[day][Math.floor(hour / 3)].push(v.outlier!);
  }
  const cells = buckets.map((row) => row.map((xs) => ({ count: xs.length, outlier: median(xs) })));
  let best: ChannelAnalytics["heatmap"]["best"] = null;
  cells.forEach((row, d) => row.forEach((c, b) => {
    if (c.count >= 3 && c.outlier !== null && (!best || c.outlier > best.outlier)) best = { day: DAYS[d], block: BLOCKS[b], outlier: c.outlier, count: c.count };
  }));

  // Title patterns and words.
  const titleFeatures = TITLE_FEATURES.map((f) => {
    const w = scored.filter((v) => f.test(v.title)), wo = scored.filter((v) => !f.test(v.title));
    const wm = median(w.map((v) => v.outlier!)), wom = median(wo.map((v) => v.outlier!));
    return { label: f.label, with: w.length, without: wo.length, withOutlier: wm, withoutOutlier: wom,
      lift: w.length >= 3 && wo.length >= 3 && wm !== null && wom ? wm / wom : null };
  }).filter((f) => f.lift !== null).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));
  const words = new Map<string, number[]>();
  for (const v of scored) for (const w of titleWords(v.title)) words.set(w, [...(words.get(w) ?? []), v.outlier!]);
  const titleWordsOut = [...words.entries()].filter(([, xs]) => xs.length >= 3)
    .map(([word, xs]) => ({ word, count: xs.length, outlier: median(xs)! })).sort((a, b) => b.outlier - a.outlier);

  const lengths = LENGTH_BUCKETS.map((b, i) => {
    const lo = i ? LENGTH_BUCKETS[i - 1].max : 0;
    const vs = scored.filter((v) => v.seconds !== null && v.seconds > lo && v.seconds <= b.max);
    return { label: b.label, count: vs.length, medianViews: median(vs.map((v) => v.views)), outlier: median(vs.map((v) => v.outlier!)) };
  }).filter((b) => b.count > 0);

  return {
    videos,
    formats: { shorts: group(videos.filter((v) => v.short && v.ageDays >= 3)), long: group(videos.filter((v) => !v.short && v.ageDays >= 3)) },
    top: byOutlier.slice(0, 6), bottom: byOutlier.slice(6).slice(-5).reverse(), // never the same video in both lists
    early: { median24, median48: median(at48), videos: earlyVideos },
    heatmap: { days: DAYS, blocks: BLOCKS, cells, best },
    titleFeatures, titleWords: titleWordsOut, lengths, timezone: TIMEZONE,
  };
}

/* ------------------------------------------------------------------ audience */
export type AudienceAnalytics = {
  perVideo: { id: string; title: string; commenters: number; newPeople: number; returning: number }[];
  monthly: { month: string; commenters: number; returning: number }[];
  languages: { month: string; counts: Record<string, number> }[];
  topLanguages: string[];
  creator: { topLevel: number; answered: number; replies: number; replyRate: number | null };
  loyal: { people: number; loyal: number; loyalShare: number | null };
};

export function audienceAnalytics(channelId: string): Promise<AudienceAnalytics> {
  return cached(`audience:${channelId}`, TTL, () => computeAudience(channelId));
}

async function computeAudience(channelId: string): Promise<AudienceAnalytics> {
  const db = sql();
  const perVideo = await db`
    with c as (
      select author_channel_id a, video_id, published_at from comments
      where channel_id = ${channelId} and author_channel_id is not null and author_channel_id <> ${channelId}),
    first_video as (select distinct on (a) a, video_id from c order by a, published_at),
    recent as (select id, title from videos where channel_id = ${channelId} and published_at is not null
               order by published_at desc limit 12)
    select r.id, r.title, count(distinct c.a)::int as commenters,
           count(distinct c.a) filter (where f.video_id = r.id)::int as new_people
    from recent r join c on c.video_id = r.id left join first_video f on f.a = c.a
    group by r.id, r.title`;
  const order = await db`select id from videos where channel_id = ${channelId} and published_at is not null order by published_at desc limit 12`;
  const rank = new Map(order.map((r, i) => [r.id as string, i]));

  const monthly = await db`
    with c as (
      select author_channel_id a, date_trunc('month', published_at) m from comments
      where channel_id = ${channelId} and author_channel_id is not null and author_channel_id <> ${channelId} and published_at is not null),
    first_month as (select a, min(m) f from c group by a)
    select to_char(c.m, 'YYYY-MM') as month, count(distinct c.a)::int as commenters,
           count(distinct c.a) filter (where f.f < c.m)::int as returning
    from c join first_month f using (a)
    where c.m >= date_trunc('month', (now() at time zone 'utc')) - interval '5 months'
    group by c.m order by c.m`;

  const langRows = await db`
    select to_char(date_trunc('month', published_at), 'YYYY-MM') as month, split_part(coalesce(language, 'und'), '-', 1) as lang,
           count(*)::int as n
    from comments
    where channel_id = ${channelId} and published_at >= date_trunc('month', (now() at time zone 'utc')) - interval '5 months'
    group by 1, 2`;
  const totals = new Map<string, number>();
  for (const r of langRows) totals.set(r.lang as string, (totals.get(r.lang as string) ?? 0) + (r.n as number));
  const topLanguages = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);
  const months = [...new Set(langRows.map((r) => r.month as string))].sort();
  const languages = months.map((month) => {
    const counts: Record<string, number> = {};
    for (const r of langRows) if (r.month === month) {
      const key = topLanguages.includes(r.lang as string) ? (r.lang as string) : "other";
      counts[key] = (counts[key] ?? 0) + (r.n as number);
    }
    return { month, counts };
  });

  const [cr] = await db`
    select count(*) filter (where parent_id is null)::int as top_level,
           count(distinct parent_id) filter (where parent_id is not null and author_channel_id = ${channelId})::int as answered,
           count(*) filter (where author_channel_id = ${channelId})::int as replies
    from comments where channel_id = ${channelId} and published_at >= (now() at time zone 'utc') - interval '90 days'`;
  const [lo] = await db`
    select count(*)::int as people, count(*) filter (where n >= 3)::int as loyal from (
      select author_channel_id, count(distinct video_id) n from comments
      where channel_id = ${channelId} and author_channel_id is not null and author_channel_id <> ${channelId}
        and published_at >= (now() at time zone 'utc') - interval '90 days'
      group by 1) x`;

  return {
    perVideo: perVideo.map((r) => ({ id: r.id as string, title: r.title as string, commenters: r.commenters as number,
      newPeople: r.new_people as number, returning: (r.commenters as number) - (r.new_people as number) }))
      .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)),
    monthly: monthly.map((r) => ({ month: r.month as string, commenters: r.commenters as number, returning: r.returning as number })),
    languages, topLanguages,
    creator: { topLevel: cr.top_level as number, answered: cr.answered as number, replies: cr.replies as number,
      replyRate: (cr.top_level as number) ? (cr.answered as number) / (cr.top_level as number) : null },
    loyal: { people: lo.people as number, loyal: lo.loyal as number, loyalShare: (lo.people as number) ? (lo.loyal as number) / (lo.people as number) : null },
  };
}

/* ------------------------------------------------------------------ topics (built by the background job) */
export type TopicRow = {
  label: string; keywords: string | null; size: number; share: number; sentiment: number | null; negative_pct: number | null;
  recent: number; trend_pct: number | null; weekly: Record<string, number>; examples: { id: string; text: string; likes: number }[]; created_at: string;
};

export async function channelTopics(channelId: string): Promise<TopicRow[]> {
  try {
    const rows = await sql()`select label, keywords, size, share, sentiment, negative_pct, recent, trend_pct, weekly, examples, created_at
      from topics where channel_id = ${channelId} order by rank`;
    return rows.map((r) => ({ ...(r as unknown as TopicRow), weekly: safeJson(r.weekly as string, {}), examples: safeJson(r.examples as string, []) }));
  } catch {
    return []; // table not created yet (the background job creates it)
  }
}

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/* ------------------------------------------------------------------ one video */
export type VideoAdvanced = {
  outlier: number | null; format: "Short" | "Long video"; typicalViews: number | null;
  views24: number | null; median24: number | null; forecast: { d7: number; d30: number } | null; ageDays: number;
};

export async function videoAdvanced(videoId: string, channelId: string): Promise<VideoAdvanced | null> {
  const ch = await channelAnalytics(channelId);
  const v = ch.videos.find((x) => x.id === videoId);
  if (!v) return null;
  const snaps = await sql()`
    select extract(epoch from (s.taken_at - v.published_at)) / 3600 as hours, s.view_count::float8 as views
    from video_snapshots s join videos v on v.id = s.video_id
    where s.video_id = ${videoId} and s.view_count is not null order by s.taken_at`;
  const points = snaps.map((s) => ({ hours: Number(s.hours), views: Number(s.views) }));
  const ageHours = v.ageDays * 24;
  const f = ageHours < 24 * 30 ? forecastViews(points, [ageHours + 7 * 24, Math.max(30 * 24, ageHours + 24)]) : null;
  const n24 = points.filter((p) => Math.abs(p.hours - 24) <= 6).sort((a, b) => Math.abs(a.hours - 24) - Math.abs(b.hours - 24))[0];
  const settled = ch.videos.filter((x) => x.ageDays >= 3 && x.ageDays <= 365 && x.short === v.short);
  return {
    outlier: v.outlier, format: v.short ? "Short" : "Long video", typicalViews: median(settled.map((x) => x.views)),
    views24: n24?.views ?? null, median24: ch.early.median24, forecast: f ? { d7: f[0], d30: f[1] } : null, ageDays: v.ageDays,
  };
}
