import "server-only";
import { sql } from "./db";
import { stored } from "./stored";
import { outlierData } from "./outliers";
import { median } from "./analytics-math";
import { pacePerDay } from "./growth-math";
import { bestSlot, engagementRate, repurposeIdeas, timingGrid, type Idea } from "./platform-math";
import type { Scored } from "./outlier-math";

/**
 * One YouTube channel next to one Instagram account: audience and its growth, output, typical reach,
 * engagement, what the audience says, when posting works best, and what to repurpose across.
 */
export type Side = {
  id: string; title: string; thumb: string | null; platform: "youtube" | "instagram";
  audience: number | null; growthPerDay: number | null; growth30: number | null;
  posts30: number; typicalViews: number | null; engagement: number | null;
  sentiment: { positive: number; neutral: number; negative: number; comments30: number };
  grid: (number | null)[][]; best: { day: number; slot: number; score: number } | null;
  hitRate: number | null; trend: { week: string; views: number }[];
};
export type SideBySide = { yt: Side | null; ig: Side | null; ideas: Idea[] };

export function sideBySide(ytId: string | null, igId: string | null): Promise<SideBySide> {
  return stored(`platforms:${ytId ?? "-"}:${igId ?? "-"}`, 30 * 60_000, () => compute(ytId, igId));
}

async function side(id: string | null, scored: Scored[]): Promise<Side | null> {
  if (!id) return null;
  const db = sql();
  const [c] = await db`select id, title, thumbnail_url, subscriber_count::float8 as subs from channels where id = ${id}`;
  if (!c) return null;
  const snaps = await db`select extract(epoch from taken_at) * 1000 as t, subscriber_count::float8 as v from channel_snapshots
    where channel_id = ${id} and subscriber_count is not null and taken_at >= (now() at time zone 'utc') - interval '30 days' order by taken_at`;
  const pts = snaps.map((s) => ({ t: Number(s.t), v: Number(s.v) }));
  const [s] = await db`select coalesce(sum(positive), 0)::int as positive, coalesce(sum(neutral), 0)::int as neutral,
      coalesce(sum(negative), 0)::int as negative, coalesce(sum(comments), 0)::int as comments
    from comment_day where channel_id = ${id} and day >= (now() at time zone 'utc')::date - 30`;
  const weeks = await db`select to_char(date_trunc('week', published_at), 'YYYY-MM-DD') as week, coalesce(sum(view_count), 0)::float8 as views
    from videos where channel_id = ${id} and published_at >= (now() at time zone 'utc') - interval '12 weeks' group by 1 order by 1`;
  const mine = scored.filter((v) => v.channel_id === id);
  const recent = mine.filter((v) => v.age <= 90);
  const settled = mine.filter((v) => v.age >= 3 && v.age <= 120);
  return {
    id, title: c.title as string, thumb: (c.thumbnail_url as string) ?? null, platform: id.startsWith("ig_") ? "instagram" : "youtube",
    audience: c.subs as number | null, growthPerDay: pacePerDay(pts), growth30: pts.length >= 2 ? pts[pts.length - 1].v - pts[0].v : null,
    posts30: mine.filter((v) => v.age <= 30).length, typicalViews: median(settled.map((v) => v.view_count ?? 0)),
    engagement: engagementRate(settled),
    sentiment: { positive: s.positive as number, neutral: s.neutral as number, negative: s.negative as number, comments30: s.comments as number },
    grid: timingGrid(mine.filter((v) => v.age <= 365)), best: bestSlot(timingGrid(mine.filter((v) => v.age <= 365))),
    hitRate: recent.length >= 5 ? recent.filter((v) => v.score >= 2).length / recent.length : null,
    trend: weeks.map((w) => ({ week: w.week as string, views: Number(w.views) })),
  };
}

async function compute(ytId: string | null, igId: string | null): Promise<SideBySide> {
  const data = await outlierData();
  const [yt, ig] = await Promise.all([side(ytId, data.scored), side(igId, data.scored)]);
  return { yt, ig, ideas: repurposeIdeas(data.scored.filter((v) => v.channel_id === ytId), data.scored.filter((v) => v.channel_id === igId)) };
}
