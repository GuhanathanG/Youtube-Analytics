import "server-only";
import { stored, sizedAge } from "./stored";
import { sql } from "./db";
import { channelAnalytics, audienceAnalytics } from "./analytics";
import { median } from "./analytics-math";
import { healthScore, normalizeBrand, type HealthInputs } from "./health-math";

const TTL = Number(process.env.ANALYTICS_CACHE_SECONDS ?? 600) * 1000; // 10 minutes

/* ================================================================== 6. unanswered questions */
export type OpenQuestion = {
  id: string; video_id: string; video_title: string; text: string; translation: string | null;
  like_count: number; reply_count: number; published_at: string; author_name: string | null; aspect: string | null;
};

/** Top-level viewer questions from the last 6 months that the creator never replied to, most liked first. */
export function unansweredQuestions(channelId: string, limit = 40): Promise<OpenQuestion[]> {
  return sizedAge(channelId, TTL).then((age) => stored(`questions:${channelId}:${limit}`, age, async () => {
    const db = sql();
    // Step 1: the most-liked recent questions (uses the channel index).
    const candidates = (await db`
      select c.id, c.video_id, v.title as video_title, c.text, c.translation, c.like_count, c.reply_count, c.published_at,
             c.author_name, split_part(split_part(coalesce(c.aspects, ''), ',', 1), ':', 1) as aspect
      from comments c join videos v on v.id = c.video_id
      where c.channel_id = ${channelId} and c.parent_id is null and c.is_question
        and coalesce(c.is_spam, false) = false and coalesce(c.author_channel_id, '') <> ${channelId}
        and c.published_at >= (now() at time zone 'utc') - interval '180 days'
      order by c.like_count desc, c.published_at desc
      limit ${limit * 4}`) as unknown as OpenQuestion[];
    if (!candidates.length) return [];
    // Step 2: one lookup for which of those the creator replied to.
    const answered = new Set((await db`select distinct parent_id from comments
      where channel_id = ${channelId} and author_channel_id = ${channelId} and parent_id in ${db(candidates.map((q) => q.id))}`)
      .map((r) => r.parent_id as string));
    return candidates.filter((q) => !answered.has(q.id)).slice(0, limit);
  }));
}

/* ================================================================== 7. channel health score */
export type Health = ReturnType<typeof healthScore> & {
  weekly: { week: string; mood: number | null; comments: number; uploads: number }[];
};

export function channelHealth(channelId: string): Promise<Health> {
  return sizedAge(channelId, TTL).then((age) => stored(`health:${channelId}`, age, () => computeHealth(channelId)));
}

export async function computeHealth(channelId: string): Promise<Health> {
  const db = sql();
  const [a, aud] = await Promise.all([channelAnalytics(channelId), audienceAnalytics(channelId)]);
  const [subs] = await db`
    select (array_agg(subscriber_count order by taken_at asc))[1]::float8 as first,
           (array_agg(subscriber_count order by taken_at desc))[1]::float8 as last,
           extract(epoch from (max(taken_at) - min(taken_at))) / 86400 as days
    from channel_snapshots where channel_id = ${channelId} and subscriber_count is not null
      and taken_at >= (now() at time zone 'utc') - interval '30 days'`;
  const [mood] = await db`
    select avg(sentiment_value)::float8 as v, count(*)::int as n from comments
    where channel_id = ${channelId} and sentiment_value is not null
      and published_at >= (now() at time zone 'utc') - interval '30 days'`;
  const weekRows = await db`
    select to_char(date_trunc('week', published_at), 'YYYY-MM-DD') as week, avg(sentiment_value)::float8 as mood, count(*)::int as comments
    from comments where channel_id = ${channelId} and published_at >= date_trunc('week', (now() at time zone 'utc')) - interval '7 weeks'
    group by 1`;
  const upRows = await db`
    select to_char(date_trunc('week', published_at), 'YYYY-MM-DD') as week, count(*)::int as uploads
    from videos where channel_id = ${channelId} and published_at >= date_trunc('week', (now() at time zone 'utc')) - interval '7 weeks'
    group by 1`;
  const monday = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x;
  };
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const w = monday(new Date(Date.now() - (7 - i) * 7 * 86400_000)).toISOString().slice(0, 10);
    const r = weekRows.find((x) => x.week === w), u = upRows.find((x) => x.week === w);
    return { week: w, mood: (r?.mood as number) ?? null, comments: (r?.comments as number) ?? 0, uploads: (u?.uploads as number) ?? 0 };
  });
  const settled = a.videos.filter((v) => v.ageDays >= 3 && v.ageDays <= 120).slice(0, 10);
  const inputs: HealthInputs = {
    subscriberGrowthPct: subs?.first && subs.last && Number(subs.days) >= 3 ? ((subs.last - subs.first) / subs.first) * 100 * (30 / Number(subs.days)) : null,
    likeRate: median(settled.flatMap((v) => (v.likeRate === null ? [] : [v.likeRate]))),
    commentRate: median(settled.flatMap((v) => (v.commentRate === null ? [] : [v.commentRate]))),
    mood: (mood?.n as number) >= 20 ? (mood.v as number) : null,
    loyalShare: aud.loyal.people >= 20 ? aud.loyal.loyalShare : null,
    weeksWithUploads: weekly.filter((w) => (w.uploads as number) > 0).length,
    weeks: weekly.length,
    recentOutlier: median(a.videos.filter((v) => v.outlier !== null).slice(0, 5).map((v) => v.outlier!)),
  };
  return {
    ...healthScore(inputs),
    weekly,
  };
}

/* ================================================================== 5. brands & sponsors */
export type BrandRow = { name: string; videos: number; sponsored: number; mentions: number; mood: number | null; examples: { id: string; title: string }[] };

export function brandTracker(channelId: string): Promise<BrandRow[]> {
  return sizedAge(channelId, TTL).then((age) => stored(`brands:${channelId}`, age, () => computeBrands(channelId)));
}

export async function computeBrands(channelId: string): Promise<BrandRow[]> {
  const db = sql();
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await db`
      select a.video_id, v.title, a.data from video_analysis a join videos v on v.id = a.video_id
      where v.channel_id = ${channelId} and a.status = 'done'`;
  } catch {
    return []; // video_analysis table not created yet
  }
  const brands = new Map<string, { name: string; videos: Set<string>; sponsored: Set<string>; titles: Map<string, string> }>();
  const add = (raw: unknown, videoId: string, title: string, sponsored: boolean) => {
    const name = normalizeBrand(String(raw ?? ""));
    if (!name) return;
    const key = name.toLowerCase();
    const b = brands.get(key) ?? { name, videos: new Set(), sponsored: new Set(), titles: new Map() };
    b.videos.add(videoId); b.titles.set(videoId, title);
    if (sponsored) b.sponsored.add(videoId);
    brands.set(key, b);
  };
  for (const r of rows) {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(String(r.data ?? "{}")); } catch { continue; }
    for (const x of (data.people_brands_products as unknown[]) ?? []) add(x, r.video_id as string, r.title as string, false);
    for (const s of (data.sponsor_segments as { brand?: string }[]) ?? []) add(s?.brand, r.video_id as string, r.title as string, true);
  }
  const top = [...brands.values()].sort((a, b) => b.sponsored.size - a.sponsored.size || b.videos.size - a.videos.size).slice(0, 15);
  if (!top.length) return [];
  const pats = top.map((b) => `%${b.name.toLowerCase().replace(/[%_\\]/g, "")}%`);
  // Comment mentions and mood per brand (15 small indexed scans of this channel's last year).
  const cols = pats.map((_, i) => `count(*) filter (where lower(text) like $${i + 2})::int as n${i}, ` +
    `avg(sentiment_value) filter (where lower(text) like $${i + 2})::float8 as m${i}`).join(", ");
  const [row] = await db.unsafe(`select ${cols} from comments where channel_id = $1
    and published_at >= (now() at time zone 'utc') - interval '365 days'`, [channelId, ...pats]);
  const stats = top.map((_, i) => ({ n: row?.[`n${i}`] as number, m: row?.[`m${i}`] as number | null }));
  return top.map((b, i) => ({
    name: b.name, videos: b.videos.size, sponsored: b.sponsored.size,
    mentions: (stats[i]?.n as number) ?? 0, mood: (stats[i]?.m as number) ?? null,
    examples: [...b.titles.entries()].slice(0, 3).map(([id, title]) => ({ id, title })),
  }));
}
