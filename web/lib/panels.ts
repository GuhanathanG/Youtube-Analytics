import "server-only";
import { stored, refreshStored, sizedAge, isHeavy, isBigChannel, takeLock, releaseLock } from "./stored";
import { sql, withLongQueries } from "./db";
import { computeCompare } from "./features";
import { aspectCounts, dailySentiment, emotionCounts, languageCounts, sentimentMix, type Filters } from "./queries";
import { commenters, predictions, topicTrends } from "./features";
import { computeAudience, computeChannel } from "./analytics";
import { computeBrands, computeHealth } from "./creator-insights";
import { RANGES } from "@/components/RangeTabs";

/**
 * The heavy sections of the channel and overview pages, as saved results (stored.ts) shared by every
 * visit. Each is worked out at most every PAGE_CACHE_SECONDS (default 10 min), usually by the engine
 * in the background (warmChannel), so opening a page is a handful of small reads.
 */
const AGE = () => Number(process.env.PAGE_CACHE_SECONDS ?? 600) * 1000;
const sinceOf = (range: string) => {
  const r = RANGES.find((x) => x.key === range);
  return r?.days ? new Date(Date.now() - r.days * 86400000) : null;
};
const f = (channelId: string | null, range: string): Filters => ({ channelId, since: sinceOf(range) });

const defs = {
  mix: (c: string, r: string) => sentimentMix(f(c, r)),
  daily: (c: string, r: string) => dailySentiment(f(c, r)),
  langs: (c: string, r: string) => languageCounts(f(c, r)),
  emos: (c: string, r: string) => emotionCounts(f(c, r)),
  aspects: (c: string, r: string) => aspectCounts(f(c, r)),
  people: (c: string) => commenters(c),
  trend: (c: string) => topicTrends(c),
  preds: (c: string) => predictions(c),
} as const;
type Name = keyof typeof defs;
type Result<N extends Name> = Awaited<ReturnType<(typeof defs)[N]>>;

const key = (name: Name, channelId: string, range: string) => `ch:${channelId}:${["mix", "daily", "langs", "emos", "aspects"].includes(name) ? range : "-"}:${name}`;

export function panel<N extends Name>(name: N, channelId: string, range = "all"): Promise<Result<N>> {
  return sizedAge(channelId, AGE()).then((age) => stored(key(name, channelId, range), age, () => defs[name](channelId, range) as Promise<Result<N>>));
}

export const overviewDaily = (range: string) =>
  stored(`overview:${range}:daily`, AGE(), () => dailySentiment({ since: sinceOf(range) }));

const ANALYTICS_AGE = () => Number(process.env.ANALYTICS_CACHE_SECONDS ?? 600) * 1000;

function channelJobs(channelId: string): [string, () => Promise<unknown>][] {
  return [
    ...(Object.keys(defs) as Name[]).map((name) => [key(name, channelId, "all"), () => defs[name](channelId, "all")] as [string, () => Promise<unknown>]),
    // Same keys as the Analytics page uses (analytics.ts, creator-insights.ts).
    [`analytics:${channelId}`, () => computeChannel(channelId)],
    [`audience:${channelId}`, () => computeAudience(channelId)],
    [`health:${channelId}`, () => computeHealth(channelId)],
    [`brands:${channelId}`, () => computeBrands(channelId)],
  ];
}

/** Engine (every 2 min): refresh one channel's saved sections that are due. On big channels the heavy
 *  sections are left to the heavy-work run (warmHeavy), so the engine never waits minutes on one. */
export async function warmChannel(channelId: string, timeLeft: () => boolean): Promise<number> {
  let n = 0;
  const [age, ana, big] = await Promise.all([sizedAge(channelId, AGE()), sizedAge(channelId, ANALYTICS_AGE()), isBigChannel(channelId)]);
  for (const [k, fn] of channelJobs(channelId)) {
    if (!timeLeft()) break;
    if (big && isHeavy(k)) continue;
    if (await refreshStored(k, k.startsWith("ch:") ? age : ana, fn).catch((e) => { console.log("[warm]", k, e instanceof Error ? e.message : e); return false; })) n++;
  }
  return n;
}

/**
 * Heavy-work run (/api/heavy, started by the engine about every 10 minutes; up to ~4 minutes): works out
 * the heavy sections of big channels, the all-time overview and saved comparisons, most out of date
 * first. Each gets up to 150 s per query on its own connection, one at a time, so pages never wait for them.
 */
export async function warmHeavy(deadline: number): Promise<{ done: string[]; skipped?: string }> {
  if (!(await takeLock("heavy", 330))) return { done: [], skipped: "another heavy run is working" };
  const done: string[] = [];
  try {
    const db = sql();
    const chans = await db`select id from channels where active order by id`;
    const due: { key: string; age: number; fn: () => Promise<unknown>; at: number }[] = [];
    const saved = new Map((await db`select key, extract(epoch from computed_at) * 1000 as at from panel_cache
      where key not like 'lock:%'`).map((r) => [r.key as string, Number(r.at)]));
    for (const c of chans) {
      const id = c.id as string;
      if (!(await isBigChannel(id))) continue; // small channels: the engine keeps them fresh
      const [age, ana] = await Promise.all([sizedAge(id, AGE()), sizedAge(id, ANALYTICS_AGE())]);
      for (const [k, fn] of channelJobs(id)) if (isHeavy(k)) due.push({ key: k, age: k.startsWith("ch:") ? age : ana, fn, at: saved.get(k) ?? 0 });
    }
    for (const [k, at] of saved) {
      if (k === "overview:all:daily") due.push({ key: k, age: AGE() * 6, fn: () => dailySentiment({ since: null }), at });
      if (k.startsWith("compare:")) {
        const ids = k.slice(8).split(",").filter(Boolean);
        due.push({ key: k, age: AGE() * 6, fn: () => computeCompare(ids), at });
      }
    }
    due.sort((a, b) => a.at - b.at); // never computed / most out of date first
    for (const d of due) {
      const left = (deadline - Date.now()) / 1000;
      if (left < 20) break;
      if (Date.now() - d.at <= d.age) continue;
      const t = Date.now();
      const ok = await refreshStored(d.key, d.age, () => withLongQueries(Math.min(150, left - 10), d.fn))
        .catch((e) => { console.log("[heavy]", d.key, e instanceof Error ? e.message : e); return false; });
      if (ok) { done.push(`${d.key} ${Math.round((Date.now() - t) / 1000)}s`); console.log("[heavy]", d.key, `${Date.now() - t} ms`); }
    }
  } finally {
    await releaseLock("heavy").catch(() => {});
  }
  return { done };
}
