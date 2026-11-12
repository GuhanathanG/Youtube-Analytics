import "server-only";
import { stored } from "./stored";
import { outlierData } from "./outliers";
import { demandLabel, demandScore, norm, opportunity, prefixesOf, titleMatches } from "./keyword-math";
import { median } from "./analytics-math";
import type { Scored } from "./outlier-math";

/**
 * Search demand and keyword scores from YouTube's free autocomplete (the same list you see while typing in
 * YouTube's search box; no API key, no quota), plus how videos with that keyword did in your niche.
 * Each keyword's report is saved for a day.
 */
const BASE = () => process.env.SUGGEST_API_BASE ?? "https://suggestqueries.google.com";

export async function suggestions(q: string): Promise<string[]> {
  const url = `${BASE()}/complete/search?client=firefox&ds=yt&hl=en&gl=IN&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000), headers: { "user-agent": "Mozilla/5.0 CreatorPulse" } });
    if (!res.ok) return [];
    const data = (await res.json()) as [string, string[]];
    return Array.isArray(data?.[1]) ? data[1].map(String).slice(0, 10) : [];
  } catch { return []; }
}

export type KeywordReport = {
  keyword: string; demand: number; label: string; opportunity: number;
  related: { q: string; demand: number | null }[];
  niche: { videos: number; medianScore: number | null; best: { id: string; title: string; score: number; views: number }[] };
};

export function keywordReport(keyword: string): Promise<KeywordReport> {
  const k = norm(keyword).slice(0, 80);
  return stored(`kw:${k}`, 24 * 3600_000, () => computeReport(k));
}

async function computeReport(k: string): Promise<KeywordReport> {
  const prefixes = prefixesOf(k);
  const results = await Promise.all(prefixes.map(async (prefix) => ({ prefix, suggestions: await suggestions(prefix) })));
  const demand = demandScore(results, k);
  const related = (results.at(-1)?.suggestions ?? []).filter((s) => norm(s) !== k).slice(0, 10);
  // A quick demand reading for the first few related searches (one request each).
  const relatedScored = await Promise.all(related.map(async (q, i) => {
    if (i >= 5) return { q, demand: null };
    const p = prefixesOf(q).slice(-2);
    const r = await Promise.all(p.map(async (prefix) => ({ prefix, suggestions: await suggestions(prefix) })));
    return { q, demand: demandScore(r, q) };
  }));
  const data = await outlierData();
  const hits: Scored[] = data.scored.filter((v) => titleMatches(v.title, k));
  const med = median(hits.map((v) => v.score));
  return {
    keyword: k, demand, label: demandLabel(demand), opportunity: opportunity(demand, med, hits.length), related: relatedScored,
    niche: { videos: hits.length, medianScore: med,
      best: [...hits].sort((a, b) => b.score - a.score).slice(0, 3).map((v) => ({ id: v.id, title: v.title, score: v.score, views: v.view_count ?? 0 })) },
  };
}

/** Starting points: words from your niche's breakout titles (what's already working). */
export async function seedKeywords(limit = 10): Promise<string[]> {
  const data = await outlierData();
  const counts = new Map<string, number>();
  for (const v of data.scored) {
    if (v.score < 2) continue;
    for (const w of norm(v.title).replace(/[^\p{L}\p{N} ]/gu, " ").split(" ")) {
      if (w.length < 4 || /^\d+$/.test(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}
