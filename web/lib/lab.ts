import "server-only";
import { sql } from "./db";
import { archiveConfigured } from "./archive";
import { trainingDb } from "./trainingdb";

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

export type AnalystModel = { trainedAt: string; release: string | null; trainPairs: number; testPairs: number; validJson: number | null;
  fields: number | null; overlap: number | null; base: string | null };

export async function analystModel(): Promise<AnalystModel | null> {
  const r = await localModel("pulse-analyst");
  if (!r) return null;
  const m = json<Record<string, unknown>>(r.metrics, {});
  const url = (json<Record<string, unknown>>(r.payload, {}).url as string) ?? null;
  return { trainedAt: String(r.trained_at), release: url?.split("/download/")[1]?.split("/")[0] ?? null, trainPairs: Number(m.train_pairs ?? 0),
    testPairs: Number(m.test_pairs ?? 0), validJson: (m.valid_json as number) ?? null, fields: (m.fields_present as number) ?? null,
    overlap: (m.summary_word_overlap as number) ?? null, base: (m.base_model as string) ?? null };
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
  channels: Record<string, number>; snapshots: number; earlySnapshotVideos: number; thumbnails: number; insights: number; archive: boolean;
  trainingVideos: number; trainingChannels: number };

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
    ...(await (async () => {
      const tdb = await trainingDb().catch(() => null);
      if (!tdb) return { trainingVideos: 0, trainingChannels: 0 };
      const [r] = await tdb`select (select count(*)::int from videos) as v, (select count(*)::int from channels where active) as c`.catch(() => [{ v: 0, c: 0 }]);
      return { trainingVideos: Number(r?.v ?? 0), trainingChannels: Number(r?.c ?? 0) };
    })()),
  };
}

export type TrainingChannel = { query: string; category: string; status: string; note: string | null; id: string | null; title: string | null;
  handle: string | null; thumb: string | null; subs: number | null; videos: number; videoCount: number | null; backfilled: boolean;
  active: boolean; lastSynced: string | null };

/** Every channel in the training database's catalog (researched list + Lab requests), with its sync progress. */
export async function trainingChannels(): Promise<{ configured: boolean; channels: TrainingChannel[]; videos: number }> {
  const db = await trainingDb();
  if (!db) return { configured: false, channels: [], videos: 0 };
  try {
    const rows = await db`
      select k.query, k.category, k.status, k.note, k.channel_id as id, coalesce(ch.title, k.title) as title, ch.handle, ch.thumbnail_url as thumb,
             coalesce(ch.subscriber_count, k.subscribers)::float8 as subs, ch.video_count::int as video_count, coalesce(ch.videos_backfilled, false) as backfilled,
             coalesce(ch.active, false) as active, ch.last_synced_at, coalesce(v.n, 0)::int as videos
      from training_catalog k
      left join channels ch on ch.id = k.channel_id
      left join (select channel_id, count(*) as n from videos group by 1) v on v.channel_id = k.channel_id
      order by k.category, coalesce(ch.subscriber_count, k.subscribers) desc nulls last`;
    const channels = rows.map((r) => ({ query: String(r.query), category: String(r.category), status: String(r.status), note: (r.note as string) ?? null,
      id: (r.id as string) ?? null, title: (r.title as string) ?? null, handle: (r.handle as string) ?? null, thumb: (r.thumb as string) ?? null,
      subs: (r.subs as number) ?? null, videos: Number(r.videos), videoCount: (r.video_count as number) ?? null, backfilled: !!r.backfilled,
      active: !!r.active, lastSynced: (r.last_synced_at as string) ?? null }));
    return { configured: true, channels, videos: channels.reduce((a, c) => a + c.videos, 0) };
  } catch {
    return { configured: true, channels: [], videos: 0 }; // tables appear with the first training run
  }
}

/** The workflows the Lab can start. */
export const TRAINERS = {
  reader: { file: "reader.yml", name: "Pulse Reader", what: "Our own comment-reading model. Fine-tunes on comments the cloud AI already read (~1–3 h on GitHub's free CPU)." },
  channels: { file: "training.yml", name: "Training channels", what: "Adds the researched niche channels and your Lab requests to the training database, then refreshes their uploads and stats (every 6 hours)." },
  analyst: { file: "analyst.yml", name: "Pulse Analyst", what: "Our own writing model: fine-tuned on Kaggle's free GPU (private) from the cloud AI's video insights, tested on held-out videos, exported to run on CPU (~1–2 h)." },
  engine: { file: "model.yml", name: "Creator Model", what: "Prediction engine: learns from every tracked channel's videos, thumbnails and early hours; keeps the better feature set (~5–15 min)." },
} as const;
export type TrainerKey = keyof typeof TRAINERS;
