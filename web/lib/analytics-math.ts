/** Pure helpers for the advanced analytics (no database), so they can be unit-tested. */

export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** ISO 8601 duration ("PT1H2M3S", "P1DT2H") to seconds. */
export function durationSeconds(iso: string | null | undefined): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}

/** YouTube Shorts can be up to 3 minutes long. */
export const isShort = (seconds: number | null) => seconds !== null && seconds > 0 && seconds <= 180;

/** Title features worth testing against results. */
export const TITLE_FEATURES: { key: string; label: string; test: (t: string) => boolean }[] = [
  { key: "emoji", label: "Has an emoji", test: (t) => /\p{Extended_Pictographic}/u.test(t) },
  { key: "number", label: "Has a number", test: (t) => /\d/.test(t) },
  { key: "question", label: "Asks a question", test: (t) => t.includes("?") },
  { key: "pipe", label: "Uses | or - separators", test: (t) => /\s[|–-]\s|\|/.test(t) },
  { key: "caps", label: "Has an ALL-CAPS word", test: (t) => /\b[A-Z]{3,}\b/.test(t) },
  { key: "hashtag", label: "Has a #hashtag", test: (t) => /#\w/u.test(t) },
  { key: "mention", label: "Mentions an @channel", test: (t) => /@\w/u.test(t) },
  { key: "short", label: "Under 40 characters", test: (t) => Array.from(t).length < 40 },
  { key: "long", label: "Over 70 characters", test: (t) => Array.from(t).length > 70 },
];

const TITLE_STOP = new Set(("the a an and or of to in on for with at by from is are this that it my your our i you we " +
  "vs part new video official full shorts short ft feat how what why when").split(" "));

export function titleWords(title: string): string[] {
  return [...new Set((title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !TITLE_STOP.has(w) && !/^\d+$/.test(w)))];
}

export const LENGTH_BUCKETS: { label: string; max: number }[] = [
  { label: "Under 1 min", max: 60 }, { label: "1–3 min", max: 180 }, { label: "3–8 min", max: 480 },
  { label: "8–15 min", max: 900 }, { label: "15–30 min", max: 1800 }, { label: "30–60 min", max: 3600 },
  { label: "Over 1 hour", max: Infinity },
];

/**
 * View forecast from snapshots: fits views = a + b·ln(hours since upload), which matches how
 * most videos slow down over time. Needs 3+ snapshots spanning 6+ hours. Never predicts fewer
 * views than now.
 */
export function forecastViews(points: { hours: number; views: number }[], atHours: number[]): number[] | null {
  const p = points.filter((x) => x.hours > 0.5 && Number.isFinite(x.views));
  if (p.length < 3 || Math.max(...p.map((x) => x.hours)) - Math.min(...p.map((x) => x.hours)) < 6) return null;
  const xs = p.map((x) => Math.log(x.hours)), ys = p.map((x) => x.views);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const b = den ? Math.max(0, num / den) : 0, a = my - b * mx;
  const now = p.reduce((best, x) => (x.hours > best.hours ? x : best));
  if (b <= 0) return atHours.map(() => now.views); // flat or falling (e.g. YouTube removed spam views): no growth
  return atHours.map((h) => Math.max(now.views, Math.round(a + b * Math.log(h))));
}

/** Monday of the week (UTC) as YYYY-MM-DD. */
export function weekOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/** Thumbnail features compared with the outlier score (same idea as title styles). */
export type ThumbLike = { faces?: number; face_emotion?: string; text_words?: number; brightness?: string; contrast?: string; readability?: string; elements?: string[]; clickbait?: number };
export const THUMB_FEATURES: { label: string; test: (t: ThumbLike) => boolean }[] = [
  { label: "Shows a face", test: (t) => (t.faces ?? 0) > 0 },
  { label: "Two or more faces", test: (t) => (t.faces ?? 0) >= 2 },
  { label: "Excited or shocked face", test: (t) => ["surprised", "shocked", "happy"].includes(t.face_emotion ?? "") },
  { label: "Has text", test: (t) => (t.text_words ?? 0) > 0 },
  { label: "3 words or fewer", test: (t) => (t.text_words ?? 0) > 0 && (t.text_words ?? 0) <= 3 },
  { label: "More than 5 words", test: (t) => (t.text_words ?? 0) > 5 },
  { label: "Bright", test: (t) => t.brightness === "bright" },
  { label: "High contrast", test: (t) => t.contrast === "high" },
  { label: "Hard to read on a phone", test: (t) => t.readability === "poor" },
  { label: "Arrows or circles", test: (t) => (t.elements ?? []).some((e) => /arrow|circle/i.test(e)) },
  { label: "Sensational (clickbait 7+)", test: (t) => (t.clickbait ?? 0) >= 7 },
];

export function featureLift<T>(items: { outlier: number; data: T }[], features: { label: string; test: (t: T) => boolean }[], minEach = 3) {
  return features.map((f) => {
    const w = items.filter((i) => f.test(i.data)).map((i) => i.outlier);
    const wo = items.filter((i) => !f.test(i.data)).map((i) => i.outlier);
    const wm = median(w), wom = median(wo);
    return { label: f.label, with: w.length, without: wo.length, withOutlier: wm, withoutOutlier: wom,
      lift: w.length >= minEach && wo.length >= minEach && wm !== null && wom ? wm / wom : null };
  }).filter((f) => f.lift !== null).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));
}
