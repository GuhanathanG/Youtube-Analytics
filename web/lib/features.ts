import "server-only";
import { sql } from "./db";
import { ASPECT_LABELS } from "./queries-shared";

/* ================================================================== 5. superfans & critics */
export type Commenter = {
  author_channel_id: string; author_name: string; comments: number; likes: number;
  avg_sentiment: number | null; recent_avg: number | null; first_at: string; last_at: string;
};

/** People who comment most on a channel, split into superfans (warm) and critics (negative). */
export async function commenters(channelId: string): Promise<{ superfans: Commenter[]; critics: Commenter[] }> {
  const rows = (await sql()`
    select author_channel_id, max(author_name) as author_name, count(*)::int as comments,
           coalesce(sum(like_count), 0)::int as likes, avg(sentiment_value)::float8 as avg_sentiment,
           avg(case when published_at >= (now() at time zone 'utc') - interval '30 days' then sentiment_value end)::float8 as recent_avg,
           min(published_at) as first_at, max(published_at) as last_at
    from comments
    where channel_id = ${channelId} and author_channel_id is not null and (is_spam is null or not is_spam)
    group by author_channel_id
    having count(*) >= 3
    order by count(*) desc
    limit 400`) as unknown as Commenter[];
  return {
    superfans: rows.filter((r) => (r.avg_sentiment ?? 0) > 0.25).slice(0, 12),
    critics: rows.filter((r) => (r.avg_sentiment ?? 0) < -0.15).slice(0, 12),
  };
}

/* ================================================================== 6. performance prediction */
export type Prediction = {
  video_id: string; title: string; age_hours: number; views: number; comments: number;
  expected_views_now: number | null; index: number | null; projected_7d: number | null; basis: string;
};

/** Typical share of 7-day views reached by a given age (hours), used until the channel has its own history. */
const DEFAULT_CURVE: [number, number][] = [[1, 0.06], [3, 0.14], [6, 0.24], [12, 0.36], [24, 0.5], [48, 0.66], [72, 0.76], [120, 0.9], [168, 1]];

function curveAt(curve: [number, number][], h: number): number {
  if (h <= curve[0][0]) return curve[0][1] * (h / curve[0][0]);
  for (let i = 1; i < curve.length; i++) {
    const [h0, f0] = curve[i - 1], [h1, f1] = curve[i];
    if (h <= h1) return f0 + ((f1 - f0) * (h - h0)) / (h1 - h0);
  }
  return 1;
}

/**
 * Early estimate for videos younger than 7 days.
 * - "channel history": compares views at the same age with the channel's earlier videos (from tracked snapshots).
 * - "typical curve": until enough history exists, uses a typical YouTube 7-day view curve and the channel's median.
 */
export async function predictions(channelId?: string): Promise<Prediction[]> {
  const db = sql();
  const young = await db`
    select v.id, v.title, v.channel_id, v.view_count::float8 as views, coalesce(v.comment_count, 0)::int as comments,
           extract(epoch from ((now() at time zone 'utc') - v.published_at)) / 3600 as age_hours
    from videos v join channels c on c.id = v.channel_id
    where c.active and v.published_at >= (now() at time zone 'utc') - interval '7 days'
      ${channelId ? db`and v.channel_id = ${channelId}` : db``}
    order by v.published_at desc limit 20`;
  if (!young.length) return [];
  const out: Prediction[] = [];
  for (const v of young) {
    const age = Math.max(0.25, Number(v.age_hours));
    // Channel history: earlier videos' views at a similar age (±25%), from snapshots.
    const peers = await db`
      select distinct on (s.video_id) s.view_count::float8 as views_then, pv.view_count::float8 as views_final,
             extract(epoch from (pv.stats_updated_at - pv.published_at)) / 3600 as final_age
      from video_snapshots s join videos pv on pv.id = s.video_id
      where pv.channel_id = ${v.channel_id as string} and pv.id <> ${v.id as string}
        and pv.published_at < (now() at time zone 'utc') - interval '7 days'
        and extract(epoch from (s.taken_at - pv.published_at)) / 3600 between ${age * 0.75} and ${age * 1.25}
      order by s.video_id, abs(extract(epoch from (s.taken_at - pv.published_at)) / 3600 - ${age})
      limit 30`;
    let expected: number | null = null, projected: number | null = null, basis = "";
    if (peers.length >= 3) {
      const thens = peers.map((p) => Number(p.views_then)).sort((a, b) => a - b);
      expected = thens[Math.floor(thens.length / 2)];
      const ratios = peers.filter((p) => Number(p.views_then) > 0).map((p) => Number(p.views_final) / Number(p.views_then)).sort((a, b) => a - b);
      const ratio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1 / curveAt(DEFAULT_CURVE, age);
      projected = age >= 168 ? Number(v.views) : Number(v.views) * Math.max(1, ratio);
      basis = `compared with ${peers.length} earlier videos at the same age`;
    } else {
      const [m] = await db`
        select percentile_cont(0.5) within group (order by view_count)::float8 as median
        from (select view_count from videos where channel_id = ${v.channel_id as string}
              and published_at < (now() at time zone 'utc') - interval '7 days' and view_count is not null
              order by published_at desc limit 20) t`;
      const share = curveAt(DEFAULT_CURVE, Math.min(age, 168));
      if (m?.median) expected = Number(m.median) * share;
      projected = Number(v.views) / Math.max(share, 0.05);
      basis = "typical YouTube curve (gets more accurate as tracking history builds up)";
    }
    // Under 3 hours old, early views swing too much to say anything useful.
    const tooEarly = age < 3;
    out.push({
      video_id: v.id as string, title: v.title as string, age_hours: age, views: Number(v.views), comments: v.comments as number,
      expected_views_now: tooEarly ? null : expected, index: !tooEarly && expected ? Number(v.views) / expected : null,
      projected_7d: tooEarly ? null : projected, basis: tooEarly ? "nothing yet: check back after 3 hours" : basis,
    });
  }
  return out;
}

/* ================================================================== 7. topic trends */
export type TopicTrend = { months: string[]; series: { key: string; label: string; counts: number[]; neg: number[] }[];
  rising: { label: string; recent: number; before: number; change: number }[] };

/** Monthly mentions of each aspect (from the AI's reading), plus what's rising or fading lately. */
export async function topicTrends(channelId: string): Promise<TopicTrend> {
  const db = sql();
  const rows = await db`
    select to_char(date_trunc('month', published_at), 'YYYY-MM') as month, aspects
    from comments where channel_id = ${channelId} and aspects is not null
      and published_at >= date_trunc('month', (now() at time zone 'utc')) - interval '11 months'`;
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const counts = new Map<string, number[]>(), neg = new Map<string, number[]>();
  for (const key of Object.keys(ASPECT_LABELS)) { counts.set(key, Array(12).fill(0)); neg.set(key, Array(12).fill(0)); }
  for (const r of rows) {
    const mi = months.indexOf(r.month as string);
    if (mi < 0) continue;
    for (const part of String(r.aspects).split(",")) {
      const [k, pol] = part.split(":");
      if (!counts.has(k)) continue;
      counts.get(k)![mi]++;
      if (pol === "neg") neg.get(k)![mi]++;
    }
  }
  const series = [...counts.entries()]
    .map(([key, c]) => ({ key, label: ASPECT_LABELS[key], counts: c, neg: neg.get(key)! }))
    .filter((s) => s.counts.some((x) => x > 0))
    .sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0));

  // Rising/fading: share of mentions in the last 30 days vs the 90 days before.
  const recent = await db`
    select aspects, (published_at >= (now() at time zone 'utc') - interval '30 days') as is_recent
    from comments where channel_id = ${channelId} and aspects is not null
      and published_at >= (now() at time zone 'utc') - interval '120 days'`;
  const r = new Map<string, number>(), b = new Map<string, number>();
  let rt = 0, bt = 0;
  for (const row of recent) {
    for (const part of String(row.aspects).split(",")) {
      const k = part.split(":")[0];
      if (!ASPECT_LABELS[k]) continue;
      if (row.is_recent) { r.set(k, (r.get(k) ?? 0) + 1); rt++; } else { b.set(k, (b.get(k) ?? 0) + 1); bt++; }
    }
  }
  const rising = Object.entries(ASPECT_LABELS)
    .map(([k, label]) => {
      const rs = rt ? ((r.get(k) ?? 0) / rt) * 100 : 0, bs = bt ? ((b.get(k) ?? 0) / bt) * 100 : 0;
      return { label, recent: rs, before: bs, change: rs - bs };
    })
    .filter((x) => x.recent + x.before > 2 && rt >= 20 && bt >= 20)
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
    .slice(0, 6);
  return { months, series: series.slice(0, 6), rising };
}

/* ================================================================== 3. comparison */
export type CompareRow = {
  id: string; title: string; thumbnail_url: string | null; subscriber_count: number | null; view_count: number | null;
  videos: number; comments: number; avg_sentiment: number | null; negative_pct: number | null; ai_pct: number | null;
  comments_per_video: number | null; questions: number; requests: number;
};

export async function compareChannels(ids: string[]) {
  const db = sql();
  if (!ids.length) return { rows: [] as CompareRow[], weekly: [] as Record<string, string | number | null>[], overlap: [] as { a: string; b: string; shared: number; jaccard: number }[] };
  const rows = (await db`
    select ch.id, ch.title, ch.thumbnail_url, ch.subscriber_count::float8 as subscriber_count, ch.view_count::float8 as view_count,
      (select count(*) from videos v where v.channel_id = ch.id)::int as videos,
      count(c.id)::int as comments, avg(c.sentiment_value)::float8 as avg_sentiment,
      (100.0 * sum(case when c.sentiment = 'negative' then 1 else 0 end) / nullif(count(c.sentiment), 0))::float8 as negative_pct,
      (100.0 * count(c.ai_at) / nullif(count(c.id), 0))::float8 as ai_pct,
      (count(c.id)::float8 / nullif((select count(*) from videos v where v.channel_id = ch.id), 0)) as comments_per_video,
      sum(case when c.is_question then 1 else 0 end)::int as questions,
      sum(case when c.is_suggestion then 1 else 0 end)::int as requests
    from channels ch left join comments c on c.channel_id = ch.id
    where ch.id in ${db(ids)}
    group by ch.id, ch.title, ch.thumbnail_url, ch.subscriber_count, ch.view_count`) as unknown as CompareRow[];

  const weeklyRows = await db`
    select channel_id, to_char(date_trunc('week', published_at), 'YYYY-MM-DD') as week, avg(sentiment_value)::float8 as s, count(*)::int as n
    from comments where channel_id in ${db(ids)} and sentiment_value is not null
      and published_at >= (now() at time zone 'utc') - interval '26 weeks'
    group by 1, 2 order by 2`;
  const byWeek = new Map<string, Record<string, string | number | null>>();
  for (const r of weeklyRows) {
    if ((r.n as number) < 5) continue; // too few comments for a stable average
    const w = byWeek.get(r.week as string) ?? { week: r.week as string };
    w[r.channel_id as string] = Math.round((r.s as number) * 100);
    byWeek.set(r.week as string, w);
  }

  // Audience overlap: people who commented on both channels.
  const overlap: { a: string; b: string; shared: number; jaccard: number }[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const [o] = await db`
      with a as (select distinct author_channel_id x from comments where channel_id = ${ids[i]} and author_channel_id is not null),
           b as (select distinct author_channel_id x from comments where channel_id = ${ids[j]} and author_channel_id is not null)
      select (select count(*) from a join b using (x))::int as shared,
             (select count(*) from (select x from a union select x from b) u)::int as total`;
    overlap.push({ a: ids[i], b: ids[j], shared: o.shared as number, jaccard: (o.total as number) ? (o.shared as number) / (o.total as number) : 0 });
  }
  return { rows, weekly: [...byWeek.values()], overlap };
}
