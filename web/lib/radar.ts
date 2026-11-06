import "server-only";
import { sql } from "./db";
import { stored } from "./stored";
import { median, titleWords } from "./analytics-math";

/**
 * Competitor radar: your channel next to the channels you marked as competitors. For each: upload
 * pace, typical views, and recent breakouts (videos far above that channel's own usual). Plus topic
 * gaps: words in competitors' breakout titles that never appear in your titles.
 */
export type RadarRow = { id: string; title: string; thumb: string | null; subs: number | null; uploads30: number; medianViews: number | null; best: number | null };
export type Breakout = { channelId: string; channel: string; id: string; title: string; thumb: string | null; views: number; outlier: number; published_at: string };
export type Radar = { me: RadarRow | null; rivals: RadarRow[]; breakouts: Breakout[]; gaps: { word: string; videos: number; lift: number }[] };

type V = { id: string; channel_id: string; title: string; thumbnail_url: string | null; view_count: number | null; published_at: string; age: number };

export function radar(mine: string): Promise<Radar> {
  return stored(`radar:${mine}`, Number(process.env.RADAR_CACHE_SECONDS ?? 1800) * 1000, () => computeRadar(mine));
}

async function computeRadar(mine: string): Promise<Radar> {
  const db = sql();
  const chans = await db`select id, title, thumbnail_url, subscriber_count::float8 as subs from channels
    where active and (id = ${mine} or role = 'competitor')`;
  if (!chans.length) return { me: null, rivals: [], breakouts: [], gaps: [] };
  const vids = (await db`select id, channel_id, title, thumbnail_url, view_count::float8 as view_count, published_at,
      extract(epoch from ((now() at time zone 'utc') - published_at)) / 86400 as age
    from videos where channel_id in ${db(chans.map((c) => c.id as string))} and published_at >= (now() at time zone 'utc') - interval '180 days'`) as unknown as V[];
  const byChannel = new Map<string, V[]>();
  for (const v of vids) byChannel.set(v.channel_id, [...(byChannel.get(v.channel_id) ?? []), v]);

  const rows: RadarRow[] = [], breakouts: Breakout[] = [];
  const outlierOf = new Map<string, number>();
  for (const c of chans) {
    const list = byChannel.get(c.id as string) ?? [];
    const settled = list.filter((v) => v.age >= 3 && (v.view_count ?? 0) > 0).sort((a, b) => b.age - a.age).slice(-20);
    const med = median(settled.map((v) => v.view_count ?? 0));
    let best: number | null = null;
    for (const v of list) {
      if (!med || v.age < 1) continue;
      const o = (v.view_count ?? 0) / med;
      outlierOf.set(v.id, o);
      if (v.age <= 60) best = Math.max(best ?? 0, o);
      if (c.id !== mine && o >= 2 && v.age <= 60) breakouts.push({ channelId: c.id as string, channel: c.title as string, id: v.id, title: v.title,
        thumb: v.thumbnail_url, views: v.view_count ?? 0, outlier: o, published_at: v.published_at });
    }
    rows.push({ id: c.id as string, title: c.title as string, thumb: (c.thumbnail_url as string) ?? null, subs: c.subs as number | null,
      uploads30: list.filter((v) => v.age <= 30).length, medianViews: med, best });
  }

  // Topic gaps: words from competitors' strong videos that you have never used in a title.
  const [{ titles }] = await db`select coalesce(string_agg(title, ' '), '') as titles from videos where channel_id = ${mine}`;
  const myWords = new Set(titleWords(String(titles)));
  const gap = new Map<string, { videos: number; lift: number[] }>();
  for (const v of vids) {
    if (v.channel_id === mine) continue;
    const o = outlierOf.get(v.id);
    if (o === undefined || o < 1.5) continue;
    for (const w of titleWords(v.title)) {
      if (myWords.has(w) || w.length < 4) continue;
      const g = gap.get(w) ?? { videos: 0, lift: [] };
      g.videos++; g.lift.push(o); gap.set(w, g);
    }
  }
  const gaps = [...gap.entries()].filter(([, g]) => g.videos >= 2)
    .map(([word, g]) => ({ word, videos: g.videos, lift: median(g.lift) ?? 1 }))
    .sort((a, b) => b.videos * b.lift - a.videos * a.lift).slice(0, 12);

  return { me: rows.find((r) => r.id === mine) ?? null, rivals: rows.filter((r) => r.id !== mine),
    breakouts: breakouts.sort((a, b) => b.outlier - a.outlier).slice(0, 9), gaps };
}
