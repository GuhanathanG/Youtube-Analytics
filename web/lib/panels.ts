import "server-only";
import { stored, refreshStored, sizedAge } from "./stored";
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

/** Engine: refresh one channel's saved sections that are due (default range only). Returns how many ran. */
export async function warmChannel(channelId: string, timeLeft: () => boolean): Promise<number> {
  let n = 0;
  const [age, ana] = await Promise.all([sizedAge(channelId, AGE()), sizedAge(channelId, Number(process.env.ANALYTICS_CACHE_SECONDS ?? 600) * 1000)]);
  const jobs: [string, () => Promise<unknown>][] = [
    ...(Object.keys(defs) as Name[]).map((name) => [key(name, channelId, "all"), () => defs[name](channelId, "all")] as [string, () => Promise<unknown>]),
    // Same keys as the Analytics page uses (analytics.ts, creator-insights.ts).
    [`analytics:${channelId}`, () => computeChannel(channelId)],
    [`audience:${channelId}`, () => computeAudience(channelId)],
    [`health:${channelId}`, () => computeHealth(channelId)],
    [`brands:${channelId}`, () => computeBrands(channelId)],
  ];
  for (const [k, fn] of jobs) {
    if (!timeLeft()) break;
    if (await refreshStored(k, k.startsWith("ch:") ? age : ana, fn).catch((e) => { console.log("[warm]", k, e instanceof Error ? e.message : e); return false; })) n++;
  }
  return n;
}
