import "server-only";
import { after } from "next/server";
import { sql, ensureRls } from "./db";
import { cached } from "./cache";

/**
 * Saved results for heavy page sections (top commenters, topic trends, analytics …).
 *
 * The in-memory cache (cache.ts) lives inside one server copy and is lost whenever Vercel starts a
 * fresh copy, so the first visit after that paid for every heavy query again. Saved results live in the
 * database instead, so every copy and every visit shares them:
 *   - fresh saved result → returned at once (one small read)
 *   - older than `maxAgeMs` → still returned at once, and refreshed after the page has been sent
 *   - nothing saved yet → worked out now (that visit waits, once)
 * The 2-minute engine also refreshes them (warmChannel in panels.ts), so pages almost never wait.
 */
let ready: Promise<void> | null = null;
function ensureTable() {
  ready ??= (async () => {
    await sql()`create table if not exists panel_cache (key text primary key, data text not null,
      computed_at timestamp not null, ms integer)`;
    await ensureRls("panel_cache");
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const refreshing = new Set<string>();
const MEMORY_MS = 30_000;

async function compute<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const value = await fn();
  await sql()`insert into panel_cache (key, data, computed_at, ms) values (${key}, ${JSON.stringify(value)}, (now() at time zone 'utc'), ${Date.now() - t})
    on conflict (key) do update set data = excluded.data, computed_at = excluded.computed_at, ms = excluded.ms`;
  return value;
}

function refreshLater<T>(key: string, fn: () => Promise<T>) {
  if (refreshing.has(key)) return;
  refreshing.add(key);
  const run = () => compute(key, fn).catch((e) => console.log("[stored]", key, e instanceof Error ? e.message : e)).finally(() => refreshing.delete(key));
  try { after(run); } catch { void run(); } // outside a request (engine, tests): just run it
}

export function stored<T>(key: string, maxAgeMs: number, fn: () => Promise<T>): Promise<T> {
  if (process.env.STORED_PANELS === "0") return fn();
  if (maxAgeMs <= 0) return ensureTable().then(() => compute(key, fn)); // "always fresh" (tests, or a setting of 0)
  return cached(`stored:${key}`, MEMORY_MS, async () => {
    await ensureTable();
    const [row] = await sql()`select data, extract(epoch from ((now() at time zone 'utc') - computed_at)) * 1000 as age
      from panel_cache where key = ${key}`;
    if (!row) return compute(key, fn);
    if (Number(row.age) > maxAgeMs) refreshLater(key, fn);
    return JSON.parse(row.data as string) as T;
  });
}

/** Re-work a saved result if it's older than `maxAgeMs` (used by the engine). Returns true if it ran. */
export async function refreshStored<T>(key: string, maxAgeMs: number, fn: () => Promise<T>): Promise<boolean> {
  await ensureTable();
  const [row] = await sql()`select extract(epoch from ((now() at time zone 'utc') - computed_at)) * 1000 as age from panel_cache where key = ${key}`;
  if (row && Number(row.age) <= maxAgeMs) return false;
  await compute(key, fn);
  return true;
}

/** Forget saved results (e.g. after pausing or adding a channel). */
export async function clearStored(prefix = "") {
  await ensureTable();
  await sql()`delete from panel_cache where key like ${prefix.replace(/[%_]/g, "\\$&") + "%"}`;
}

/**
 * How long a channel's all-time sections stay fresh, by channel size. A channel with 770k comments
 * gains a few hundred an hour, so re-scanning everything every 10 minutes changed nothing on screen but
 * kept the database busy (each scan 1-12 s) and slowed every page. Up to 50k comments: the base age;
 * above that it grows with size (about 2.5 hours at 750k), capped at 24× the base.
 */
const sizes = { at: 0, map: new Map<string, number>() };
export async function sizedAge(channelId: string | null | undefined, baseMs: number): Promise<number> {
  if (baseMs <= 0 || !channelId) return baseMs;
  if (Date.now() - sizes.at > 300_000) {
    try {
      const rows = await sql()`select channel_id, comments from channel_summary`;
      sizes.map = new Map(rows.map((r) => [r.channel_id as string, Number(r.comments) || 0]));
    } catch { /* table not there yet: base age */ }
    sizes.at = Date.now();
  }
  const n = sizes.map.get(channelId) ?? 0;
  return Math.round(baseMs * Math.min(24, Math.max(1, n / 50_000)));
}
