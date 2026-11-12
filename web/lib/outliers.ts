import "server-only";
import { sql } from "./db";
import { stored } from "./stored";
import { scoreVideos, type OVideo, type Scored } from "./outlier-math";

/**
 * Niche outlier finder: every tracked channel (yours and competitors, YouTube and Instagram) scored
 * against its own normal, so you see which uploads in your niche broke out and what they share.
 * Saved for 30 minutes (one small read per visit); the scoring itself is cheap.
 */
export type ChannelInfo = { id: string; title: string; thumb: string | null; role: string | null };
export type OutlierData = { scored: Scored[]; channels: ChannelInfo[] };

export function outlierData(): Promise<OutlierData> {
  return stored("outliers:all", Number(process.env.OUTLIER_CACHE_SECONDS ?? 1800) * 1000, compute);
}

async function compute(): Promise<OutlierData> {
  const db = sql();
  const chans = (await db`select id, title, thumbnail_url as thumb, role from channels where active`) as unknown as ChannelInfo[];
  if (!chans.length) return { scored: [], channels: [] };
  const vids = (await db`select id, channel_id, title, thumbnail_url, duration, view_count::float8 as view_count,
      like_count::float8 as like_count, comment_count::float8 as comment_count, published_at::text as published_at,
      extract(epoch from ((now() at time zone 'utc') - published_at)) / 86400 as age
    from videos where channel_id in ${db(chans.map((c) => c.id))} and published_at is not null and view_count is not null`) as unknown as OVideo[];
  return { scored: scoreVideos(vids.map((v) => ({ ...v, age: Number(v.age) }))), channels: chans };
}
