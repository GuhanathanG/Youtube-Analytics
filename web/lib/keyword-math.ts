/**
 * Keyword scores from YouTube's free search suggestions (no app imports: tested in tests/logic.test.ts).
 *
 * YouTube has no free search-volume number. What it does show is autocomplete: the more people search a
 * phrase, the fewer letters you need to type before YouTube suggests it, and the higher it ranks. So demand
 * is read from the shortest prefix that already suggests the phrase, and its position in that list.
 */
export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Prefixes to type: about a third, two thirds, then the whole phrase (at least 2 characters each). */
export function prefixesOf(keyword: string): string[] {
  const k = norm(keyword);
  const cuts = [Math.ceil(k.length * 0.34), Math.ceil(k.length * 0.67), k.length].map((n) => Math.max(2, Math.min(k.length, n)));
  return [...new Set(cuts.map((n) => k.slice(0, n).trimEnd()))].filter((p) => p.length >= 2);
}

/** Where the keyword shows up in a suggestion list: 0 = first, -1 = not there (a suggestion that starts with it counts). */
export function rankIn(suggestions: string[], keyword: string): number {
  const k = norm(keyword);
  const exact = suggestions.findIndex((s) => norm(s) === k);
  if (exact >= 0) return exact;
  return suggestions.findIndex((s) => norm(s).startsWith(k + " "));
}

/**
 * Demand 0-100 from the prefix results (same order as prefixesOf). Found after a third of the letters:
 * 70-100; after two thirds: 45-70; only when typed in full: 20-45; YouTube suggests nothing for it: 5.
 */
export function demandScore(results: { prefix: string; suggestions: string[] }[], keyword: string): number {
  const total = results.length;
  for (const [i, r] of results.entries()) {
    const rank = rankIn(r.suggestions, keyword);
    if (rank < 0) continue;
    const stage = total - 1 - i; // how many prefixes were still left to type
    const top = stage >= 2 ? 100 : stage === 1 ? 70 : 45, bottom = stage >= 2 ? 70 : stage === 1 ? 45 : 20;
    return Math.round(top - (Math.min(rank, 9) / 9) * (top - bottom));
  }
  return results.some((r) => r.suggestions.length) ? 5 : 0;
}

export const demandLabel = (d: number) => (d >= 70 ? "High demand" : d >= 45 ? "Solid demand" : d >= 20 ? "Niche demand" : "Little search demand");

/**
 * Overall opportunity: search demand, lifted when videos using the phrase in your niche beat their channel's
 * normal (median outlier score), lowered when they fell short. No niche videos yet: demand alone.
 */
export function opportunity(demand: number, nicheMedianScore: number | null, nicheVideos: number): number {
  if (nicheMedianScore === null || nicheVideos < 2) return demand;
  const proof = Math.max(-25, Math.min(25, Math.log2(nicheMedianScore) * 15));
  return Math.max(0, Math.min(100, Math.round(demand + proof)));
}

/** Videos whose title contains every word of the keyword (any order, any case). */
export function titleMatches(title: string, keyword: string): boolean {
  const t = norm(title);
  return norm(keyword).split(" ").filter(Boolean).every((w) => t.includes(w));
}
