import { after } from "next/server";

/** A promise we stop waiting for may still be using a database connection. Keep the server copy running
 *  until it settles (the database stops any query after 25 s), so the connection is never left
 *  half-way through a query when Vercel pauses the copy, which would block that connection for minutes. */
function letFinish(p: Promise<unknown>) {
  try { after(() => p.then(() => undefined, () => undefined)); } catch { /* outside a request: nothing pauses us */ }
}

/**
 * Tiny in-memory cache for heavy summary queries (counts over every comment). Server copies are
 * reused between requests, so repeated page views within the TTL skip the database scan.
 * Your own changes (add/pause channel) clear it straight away.
 *
 * Safety: a result that hasn't arrived after CACHE_WAIT_SECONDS (default 25 s) is dropped and the
 * caller gets an error instead of waiting forever, so one stuck query can never freeze every page.
 */
type Entry = { at: number; value: Promise<unknown>; settled: boolean };
const store = new Map<string, Entry>();
// The last good result of each key: when the database is busy and a fresh one takes too long, pages
// show this instead of an error ("Something went wrong").
const lastGood = new Map<string, unknown>();
const WAIT_MS = Number(process.env.CACHE_WAIT_SECONDS ?? 12) * 1000;

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && (Date.now() - hit.at < ttlMs || !hit.settled)) return withLimit(hit.value as Promise<T>, key, hit);
  const entry: Entry = { at: Date.now(), value: Promise.resolve(), settled: false };
  entry.value = fn().then(
    (v) => { entry.settled = true; entry.at = Date.now(); lastGood.set(key, v); return v; },
    (e) => { if (store.get(key) === entry) store.delete(key); throw e; },
  );
  store.set(key, entry);
  return withLimit(entry.value as Promise<T>, key, entry);
}

function withLimit<T>(p: Promise<T>, key: string, entry: Entry): Promise<T> {
  if (entry.settled) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      if (store.get(key) === entry && !entry.settled) store.delete(key); // don't hand a stuck result to the next visitor
      letFinish(p);
      if (lastGood.has(key)) resolve(lastGood.get(key) as T); // slightly older data beats an error page
      else reject(new Error("This is taking too long; try again in a moment."));
    }, WAIT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Give up on a slow promise after `ms` and use `fallback` (for optional page sections). */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => { letFinish(p); resolve(fallback); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

export function clearCache() {
  store.clear();
}
