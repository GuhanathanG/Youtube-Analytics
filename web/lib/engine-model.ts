import "server-only";
import { sql } from "./db";
import type { LinearModel } from "./whatif";

/**
 * Reads what the prediction engine (worker: ytanalytics/model.py, trained daily by
 * .github/workflows/model.yml) saved: its measured accuracy, the drivers it found for a channel,
 * forecasts for young videos, and the small linear model for the what-if estimator.
 */
export type Driver = { key: string; label: string; kind: string; effect: number; support: number; hour?: number; day?: number; minutes?: number };
export type EngineMetrics = {
  tested: number; within_2x?: number; baseline_within_2x?: number; typical_miss?: number; baseline_typical_miss?: number;
  rank_corr?: number | null; live_graded?: number; live_within_2x?: number;
};
export type Engine = { trainedAt: string; videos: number; channels: number; metrics: EngineMetrics; drivers: Driver[]; linear: LinearModel | null };
export type Forecast = {
  video_id: string; title: string; published_at: string; views_now: number | null; views_30d: number; low: number; high: number;
  vs_normal: number; baseline: number; confidence: number; likes_30d: number | null;
};

const parse = <T,>(s: unknown, d: T): T => { try { return s ? (JSON.parse(String(s)) as T) : d; } catch { return d; } };

export async function engineFor(channelId: string): Promise<Engine | null> {
  try {
    const [r] = await sql()`select trained_at, n_videos, n_channels, metrics, drivers, linear from engine_model where id = ${channelId}`;
    if (!r) return null;
    return { trainedAt: String(r.trained_at), videos: Number(r.n_videos), channels: Number(r.n_channels),
      metrics: parse(r.metrics, { tested: 0 }), drivers: parse(r.drivers, []), linear: parse(r.linear, null) };
  } catch { return null; } // the worker hasn't created the tables yet
}

export async function forecastsFor(channelId: string, limit = 15): Promise<Forecast[]> {
  try {
    const rows = await sql()`
      select f.video_id, v.title, v.published_at, v.view_count::float8 as views_now, f.views_30d, f.low, f.high, f.vs_normal, f.baseline,
        f.confidence, f.likes_30d
      from video_forecast f join videos v on v.id = f.video_id
      where f.channel_id = ${channelId} and v.published_at >= (now() at time zone 'utc') - interval '30 days'
      order by v.published_at desc limit ${limit}`;
    return rows as unknown as Forecast[];
  } catch { return []; }
}

export async function forecastFor(videoId: string): Promise<Forecast | null> {
  try {
    const [r] = await sql()`select f.video_id, v.title, v.published_at, v.view_count::float8 as views_now, f.views_30d, f.low, f.high,
      f.vs_normal, f.baseline, f.confidence, f.likes_30d from video_forecast f join videos v on v.id = f.video_id where f.video_id = ${videoId}`;
    return (r as unknown as Forecast) ?? null;
  } catch { return null; }
}
