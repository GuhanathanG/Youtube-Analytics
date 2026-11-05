/**
 * Tiny in-memory cache for heavy summary queries (counts over every comment). Server copies are
 * reused between requests, so repeated page views within the TTL skip the database scan.
 * Your own changes (add/pause channel) clear it straight away.
 */
type Entry = { at: number; value: Promise<unknown> };
const store = new Map<string, Entry>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn().catch((e) => { store.delete(key); throw e; });
  store.set(key, { at: Date.now(), value });
  return value;
}

export function clearCache() {
  store.clear();
}
