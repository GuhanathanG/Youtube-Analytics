import { TITLE_FEATURES, titleWords } from "./analytics-math.ts"; // ".ts" so the unit tests can run it directly in Node

/**
 * Packaging Lab: score a draft title against what has actually worked on this channel.
 * Pure (no database) so it can be unit-tested and run instantly while typing.
 */
export type TitleContext = {
  features: { label: string; with: number; without: number; lift: number | null }[];   // from channelAnalytics.titleFeatures
  words: { word: string; count: number; outlier: number }[];                            // from channelAnalytics.titleWords
  demand: string[];                                                                      // words viewers ask for (requests, questions)
};
export type TitleScore = { title: string; score: number; grade: string; good: string[]; fix: string[] };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreTitle(title: string, ctx: TitleContext): TitleScore {
  const t = title.trim();
  const good: string[] = [], fix: string[] = [];
  let s = 50;
  const len = Array.from(t).length;
  if (!t) return { title, score: 0, grade: "–", good, fix: ["Write a title first."] };

  // Length: titles that fit on a phone screen read best.
  if (len >= 28 && len <= 70) { s += 6; good.push(`Good length (${len} characters)`); }
  else if (len < 28) { s -= 4; fix.push(`Short (${len} characters): add the benefit or the stakes`); }
  else if (len > 90) { s -= 10; fix.push(`Long (${len} characters): it gets cut off on phones`); }
  else { fix.push(`A bit long (${len} characters): front-load the key words`); }
  if (t === t.toUpperCase() && /[A-Z]/.test(t)) { s -= 10; fix.push("All capitals reads as shouting: keep caps for one key word"); }

  // Title patterns, weighed by how they performed on this channel.
  const featureByLabel = new Map(ctx.features.map((f) => [f.label, f]));
  for (const f of TITLE_FEATURES) {
    const stat = featureByLabel.get(f.label);
    if (!stat || stat.lift === null || stat.with < 3 || stat.without < 3) continue;
    const has = f.test(t);
    const delta = Math.max(-12, Math.min(12, (stat.lift - 1) * 20));
    if (has && stat.lift >= 1.15) { s += delta; good.push(`${f.label}: ${stat.lift.toFixed(1)}× views on this channel`); }
    else if (has && stat.lift <= 0.85) { s += delta; fix.push(`${f.label} tends to do worse here (${stat.lift.toFixed(1)}×)`); }
    else if (!has && stat.lift >= 1.3) { fix.push(`Try: ${f.label.toLowerCase()} (${stat.lift.toFixed(1)}× views here)`); }
  }

  // Words from this channel's breakout and weak titles.
  const words = new Set(titleWords(t));
  const strong = ctx.words.filter((w) => w.count >= 2 && w.outlier >= 1.5 && words.has(w.word)).slice(0, 3);
  const weak = ctx.words.filter((w) => w.count >= 2 && w.outlier <= 0.7 && words.has(w.word)).slice(0, 2);
  if (strong.length) { s += Math.min(15, strong.length * 6); good.push(`Proven words: ${strong.map((w) => `“${w.word}” ${w.outlier.toFixed(1)}×`).join(", ")}`); }
  if (weak.length) { s -= weak.length * 5; fix.push(`Words that under-performed here: ${weak.map((w) => `“${w.word}”`).join(", ")}`); }

  // What the audience asks for.
  const asked = ctx.demand.filter((d) => words.has(d)).slice(0, 3);
  if (asked.length) { s += 10; good.push(`Matches what viewers ask for: ${asked.join(", ")}`); }
  else if (ctx.demand.length) fix.push(`Viewers often ask about: ${ctx.demand.slice(0, 3).join(", ")}`);

  const score = clamp(s);
  const grade = score >= 80 ? "Strong" : score >= 65 ? "Good" : score >= 50 ? "Okay" : "Weak";
  return { title: t, score, grade, good, fix };
}

/** Most frequent meaningful words in viewer requests and questions (the audience's own vocabulary). */
export function demandWords(texts: string[], limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) for (const w of titleWords(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].filter(([w, n]) => n >= 2 && !/^(please|make|video|bro|anna|bhai|sir|can|you|next|when|will|one|also|more)$/.test(w))
    .sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}
