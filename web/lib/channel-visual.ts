import "server-only";
import { sql } from "./db";
import { stored } from "./stored";
import { outlierData } from "./outliers";

/**
 * The channel page's hero visuals: a 26-week timeline (views of that week's uploads as bars, comments as a
 * line) with event pins (breakouts, title changes), and a thumbnail wall of recent uploads sized by views.
 * Saved for 30 minutes.
 */
export type Week = { week: string; views: number; uploads: number; comments: number };
export type Pin = { week: string; kind: "breakout" | "title"; id: string; label: string; score?: number };
export type WallItem = { id: string; title: string; thumb: string | null; views: number; score: number | null; published_at: string };
export type ChannelVisual = { weeks: Week[]; pins: Pin[]; wall: WallItem[] };

export function channelVisual(channelId: string): Promise<ChannelVisual> {
  return stored(`chvis:${channelId}`, 30 * 60_000, () => compute(channelId));
}

const weekOf = (iso: string) => {
  const d = new Date(iso.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z"));
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return monday.toISOString().slice(0, 10);
};

async function compute(channelId: string): Promise<ChannelVisual> {
  const db = sql();
  const [vids, comm, changes, data] = await Promise.all([
    db`select id, title, thumbnail_url, coalesce(view_count, 0)::float8 as views, published_at::text as published_at
       from videos where channel_id = ${channelId} and published_at >= (now() at time zone 'utc') - interval '26 weeks' order by published_at desc`,
    db`select to_char(date_trunc('week', day), 'YYYY-MM-DD') as week, coalesce(sum(comments), 0)::int as comments
       from comment_day where channel_id = ${channelId} and day >= (now() at time zone 'utc')::date - 182 group by 1`,
    db`select x.video_id, x.new_value, x.changed_at::text as at from video_changes x join videos v on v.id = x.video_id
       where v.channel_id = ${channelId} and x.field = 'title' and x.changed_at >= (now() at time zone 'utc') - interval '26 weeks'`
      .catch(() => [] as never[]), // the table appears the first time the Growth page is opened
    outlierData(),
  ]);
  // 26 weeks, oldest first, Monday-based (same as Postgres date_trunc('week')).
  const now = new Date();
  const weeks: Week[] = Array.from({ length: 26 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (25 - i) * 7));
    return { week: weekOf(d.toISOString()), views: 0, uploads: 0, comments: 0 };
  });
  const at = new Map(weeks.map((w) => [w.week, w]));
  for (const v of vids) { const w = at.get(weekOf(v.published_at as string)); if (w) { w.views += Number(v.views); w.uploads++; } }
  for (const c of comm) { const w = at.get(c.week as string); if (w) w.comments += Number(c.comments); }

  const score = new Map(data.scored.filter((s) => s.channel_id === channelId).map((s) => [s.id, s.score]));
  const pins: Pin[] = [];
  for (const v of vids) {
    const s = score.get(v.id as string);
    if (s !== undefined && s >= 3) pins.push({ week: weekOf(v.published_at as string), kind: "breakout", id: v.id as string, label: v.title as string, score: s });
  }
  for (const c of changes as { video_id: string; new_value: string; at: string }[]) {
    pins.push({ week: weekOf(c.at), kind: "title", id: c.video_id, label: `Title changed: ${c.new_value}` });
  }
  const wall: WallItem[] = vids.slice(0, 18).map((v) => ({ id: v.id as string, title: v.title as string, thumb: (v.thumbnail_url as string) ?? null,
    views: Number(v.views), score: score.get(v.id as string) ?? null, published_at: v.published_at as string }));
  return { weeks, pins: pins.filter((p) => at.has(p.week)), wall };
}
