import "server-only";
import { sql } from "./db";
import { archiveConfigured } from "./archive";

/**
 * Model Lab: everything about our own models in one place.
 *   - the models (Pulse Reader, Creator Model / prediction engine, Tanglish mood head): version, when trained,
 *     how they scored on the held-out data, which one is in use;
 *   - the training data they learn from;
 *   - training-only channels (role = 'training'): watched for videos and stats only, hidden from the dashboard.
 */

export type ReaderTask = { accuracy?: number; macro_f1?: number; f1?: number; exact_match?: number; threshold: number | null;
  coverage: number; agreement: number | null; positives?: number };
export type ReaderModel = { trainedAt: string; url: string | null; release: string | null; trainRows: number; testRows: number;
  minutes: number | null; base: string | null; tasks: Record<string, ReaderTask>; thresholds: Record<string, number | null> };
export type EngineScore = { tested?: number; within_2x?: number; baseline_within_2x?: number; typical_miss?: number; rank_corr?: number | null };
export type EngineModel = { platform: string; trainedAt: string; videos: number; channels: number; featureSet: string;
  metrics: EngineScore & { live_graded?: number; live_within_2x?: number }; candidates: Record<string, EngineScore> };
export type TanglishModel = { trainedAt: string; macro_f1: number | null; current_macro_f1: number | null; trained_on: number | null; in_use: boolean };

const json = <T,>(s: unknown, fallback: T): T => {
  try { return typeof s === "string" ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};

async function localModel(name: string) {
  try {
    const [r] = await sql()`select trained_at, metrics, payload from local_models where name = ${name}`;
    return r ?? null;
  } catch { return null; }
}

export async function readerModel(): Promise<ReaderModel | null> {
  const r = await localModel("pulse-reader");
  if (!r) return null;
  const m = json<Record<string, unknown>>(r.metrics, {});
  const p = json<Record<string, unknown>>(r.payload, {});
  const url = (p.url as string) ?? null;
  return {
    trainedAt: String(r.trained_at), url, release: url?.split("/download/")[1]?.split("/")[0] ?? null,
    trainRows: Number(m.train_rows ?? 0), testRows: Number(m.test_rows ?? 0), minutes: (m.minutes as number) ?? null,
    base: (m.base_model as string) ?? null, tasks: (m.tasks as Record<string, ReaderTask>) ?? {},
    thresholds: (p.thresholds as Record<string, number | null>) ?? {},
  };
}

export async function tanglishModel(): Promise<TanglishModel | null> {
  const r = await localModel("tanglish");
  if (!r) return null;
  const m = json<Record<string, unknown>>(r.metrics, {});
  return { trainedAt: String(r.trained_at), macro_f1: (m.macro_f1 as number) ?? null, current_macro_f1: (m.current_macro_f1 as number) ?? null,
    trained_on: (m.trained_on as number) ?? null, in_use: !!m.in_use };
}

/** One row per platform: the prediction engine (Creator Model) as last trained. */
export async function engineModels(): Promise<EngineModel[]> {
  try {
    const rows = await sql()`
      select distinct on (coalesce(c.platform, 'youtube')) coalesce(c.platform, 'youtube') as platform,
             m.trained_at, m.n_videos, m.n_channels, m.metrics
      from engine_model m join channels c on c.id = m.id
      order by coalesce(c.platform, 'youtube'), m.trained_at desc`;
    return rows.map((r) => {
      const m = json<Record<string, unknown>>(r.metrics, {});
      return { platform: String(r.platform), trainedAt: String(r.trained_at), videos: Number(r.n_videos), channels: Number(r.n_channels),
        featureSet: (m.feature_set as string) ?? "base", metrics: m as EngineModel["metrics"],
        candidates: (m.candidates as Record<string, EngineScore>) ?? {} };
    });
  } catch { return []; }
}

export type TrainingData = { aiLabelledMain: number; aiLabelledArchive: number; archiveComments: number; videos: Record<string, number>;
  channels: Record<string, number>; snapshots: number; earlySnapshotVideos: number; thumbnails: number; insights: number; archive: boolean };

export async function trainingData(): Promise<TrainingData> {
  const db = sql();
  const one = async <T,>(q: PromiseLike<readonly unknown[]>, fb: T): Promise<T> => { try { return ((await q)[0] as T) ?? fb; } catch { return fb; } };
  const [main, arch, vids, chans, snaps, extra] = await Promise.all([
    one(db`select count(*)::int as n from comments where ai_at is not null and coalesce(ai_model, '') not like 'rules%' and coalesce(ai_model, '') not like 'local%'`, { n: 0 }),
    one(db`select coalesce(sum(ai_read), 0)::int as ai, coalesce(sum(comments), 0)::int as total from archive_stats`, { ai: 0, total: 0 }),
    db`select coalesce(c.role, 'yours') as role, count(*)::int as n from videos v join channels c on c.id = v.channel_id group by 1`.catch(() => []),
    db`select coalesce(role, 'yours') as role, count(*)::int as n from channels where active group by 1`.catch(() => []),
    one(db`select count(*)::int as n,
        (select count(distinct s.video_id)::int from video_snapshots s join videos v on v.id = s.video_id
          where s.taken_at - v.published_at between interval '18 hours' and interval '30 hours') as early
        from video_snapshots`, { n: 0, early: 0 }),
    one(db`select (select count(*)::int from thumb_analysis where status = 'done') as thumbs, (select count(*)::int from insights) as insights`, { thumbs: 0, insights: 0 }),
  ]);
  return {
    aiLabelledMain: Number(main.n), aiLabelledArchive: Number(arch.ai), archiveComments: Number(arch.total),
    videos: Object.fromEntries((vids as { role: string; n: number }[]).map((r) => [r.role, r.n])),
    channels: Object.fromEntries((chans as { role: string; n: number }[]).map((r) => [r.role, r.n])),
    snapshots: Number(snaps.n), earlySnapshotVideos: Number(snaps.early), thumbnails: Number(extra.thumbs), insights: Number(extra.insights),
    archive: await archiveConfigured().catch(() => false),
  };
}

export type TrainingChannel = { id: string; title: string; handle: string | null; thumb: string | null; subs: number | null;
  videos: number; videoCount: number | null; backfilled: boolean; active: boolean; lastSynced: string | null; added: string | null };

export async function trainingChannels(): Promise<TrainingChannel[]> {
  try {
    const rows = await sql()`
      select ch.id, ch.title, ch.handle, ch.thumbnail_url as thumb, ch.subscriber_count::float8 as subs, ch.video_count::int as video_count,
             ch.videos_backfilled as backfilled, ch.active, ch.last_synced_at, ch.added_at, coalesce(v.n, 0)::int as videos
      from channels ch left join (select channel_id, count(*) as n from videos group by 1) v on v.channel_id = ch.id
      where ch.role = 'training' order by ch.added_at desc`;
    return rows.map((r) => ({ id: String(r.id), title: String(r.title), handle: (r.handle as string) ?? null, thumb: (r.thumb as string) ?? null,
      subs: (r.subs as number) ?? null, videos: Number(r.videos), videoCount: (r.video_count as number) ?? null, backfilled: !!r.backfilled,
      active: !!r.active, lastSynced: (r.last_synced_at as string) ?? null, added: (r.added_at as string) ?? null }));
  } catch { return []; }
}

/** The workflows the Lab can start. */
export const TRAINERS = {
  reader: { file: "reader.yml", name: "Pulse Reader", what: "Our own comment-reading model. Fine-tunes on comments the cloud AI already read (~1–3 h on GitHub's free CPU)." },
  engine: { file: "model.yml", name: "Creator Model", what: "Prediction engine: learns from every tracked channel's videos, thumbnails and early hours; keeps the better feature set (~5–15 min)." },
} as const;
export type TrainerKey = keyof typeof TRAINERS;
