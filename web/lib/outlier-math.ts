/**
 * Outlier finder maths (no app imports, so it can be tested on its own: tests/logic.test.ts).
 *
 * A video's "outlier score" = its views ÷ its channel's normal at the time it came out: the median of
 * that channel's previous 20 settled uploads of the same kind (Shorts with Shorts, long videos with long
 * ones, reels with reels). Only earlier uploads count, so a hit doesn't raise its own bar.
 */
import { TITLE_FEATURES, durationSeconds, median } from "./analytics-math.ts"; // ".ts" so the unit tests can run it in Node

export type OVideo = {
  id: string; channel_id: string; title: string; thumbnail_url: string | null; duration: string | null;
  view_count: number | null; like_count: number | null; comment_count: number | null; published_at: string; age: number;
};
export type Kind = "short" | "long" | "reel" | "post";
export type Scored = OVideo & { kind: Kind; normal: number; score: number };

export function kindOf(v: Pick<OVideo, "id" | "duration">): Kind {
  const secs = durationSeconds(v.duration);
  if (v.id.startsWith("ig_")) return secs ? "reel" : "post";
  return secs !== null && secs > 0 && secs <= 180 ? "short" : "long";
}

/** Score every video that has at least 5 earlier settled uploads of its kind on its channel. */
export function scoreVideos(videos: OVideo[], settleDays = 3, window = 20): Scored[] {
  const out: Scored[] = [];
  const byKey = new Map<string, OVideo[]>();
  for (const v of videos) {
    if (!v.published_at || v.view_count === null) continue;
    const key = `${v.channel_id}|${kindOf(v)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), v]);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => a.published_at.localeCompare(b.published_at));
    const history: number[] = [];
    for (const v of list) {
      if (history.length >= 5) {
        const normal = median(history.slice(-window)) ?? 0;
        if (normal > 0 && v.age >= 1) out.push({ ...v, kind: kindOf(v), normal, score: (v.view_count ?? 0) / normal });
      }
      if (v.age >= settleDays) history.push(v.view_count ?? 0);
    }
  }
  return out;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Hour in India time (the creators' audience), from a UTC timestamp. */
const istHour = (iso: string) => (new Date(iso.replace(" ", "T") + (/[zZ+]/.test(iso.slice(10)) ? "" : "Z")).getUTCHours() + 5.5) % 24;
const istDay = (iso: string) => {
  const d = new Date(iso.replace(" ", "T") + (/[zZ+]/.test(iso.slice(10)) ? "" : "Z"));
  return new Date(d.getTime() + 5.5 * 3600_000).getUTCDay();
};

export type Trait = { label: string; group: string; test: (v: Scored) => boolean };
export const TRAITS: Trait[] = [
  ...TITLE_FEATURES.map((f) => ({ label: f.label, group: "title", test: (v: Scored) => f.test(v.title) })),
  { label: "Short title (under 40 characters)", group: "title", test: (v) => v.title.length < 40 },
  { label: "Long title (70+ characters)", group: "title", test: (v) => v.title.length >= 70 },
  { label: "A Short (under 3 min)", group: "format", test: (v) => v.kind === "short" },
  { label: "A long video", group: "format", test: (v) => v.kind === "long" },
  { label: "20+ minutes long", group: "format", test: (v) => (durationSeconds(v.duration) ?? 0) >= 1200 },
  { label: "A reel", group: "format", test: (v) => v.kind === "reel" },
  ...DAYS.map((d, i) => ({ label: `Posted on ${d}`, group: "timing", test: (v: Scored) => istDay(v.published_at) === i })),
  { label: "Posted in the morning (6–12)", group: "timing", test: (v) => { const h = istHour(v.published_at); return h >= 6 && h < 12; } },
  { label: "Posted in the afternoon (12–17)", group: "timing", test: (v) => { const h = istHour(v.published_at); return h >= 12 && h < 17; } },
  { label: "Posted in the evening (17–22)", group: "timing", test: (v) => { const h = istHour(v.published_at); return h >= 17 && h < 22; } },
  { label: "Posted late night (22–6)", group: "timing", test: (v) => { const h = istHour(v.published_at); return h >= 22 || h < 6; } },
];

export type Pattern = { label: string; group: string; inOutliers: number; inAll: number; ratio: number; outliers: number };

/** Traits that are much more common among outliers than among all scored videos (needs a few examples each). */
export function patterns(all: Scored[], outliers: Scored[], minOutliers = 3): Pattern[] {
  if (outliers.length < minOutliers || all.length < 10) return [];
  return TRAITS.map((t) => {
    const o = outliers.filter(t.test).length, a = all.filter(t.test).length;
    const inOutliers = o / outliers.length, inAll = a / all.length;
    return { label: t.label, group: t.group, inOutliers, inAll, ratio: inAll > 0 ? inOutliers / inAll : 0, outliers: o };
  }).filter((p) => p.outliers >= minOutliers && p.ratio >= 1.25).sort((a, b) => b.ratio - a.ratio).slice(0, 8);
}

/** Score bands for the distribution strip: how many videos land in each multiple of normal. */
export const BANDS = [
  { label: "< 0.5×", min: 0, max: 0.5 }, { label: "0.5–1×", min: 0.5, max: 1 }, { label: "1–2×", min: 1, max: 2 },
  { label: "2–3×", min: 2, max: 3 }, { label: "3–5×", min: 3, max: 5 }, { label: "5–10×", min: 5, max: 10 }, { label: "10×+", min: 10, max: Infinity },
];
export const bandCounts = (xs: Scored[]) => BANDS.map((b) => xs.filter((v) => v.score >= b.min && v.score < b.max).length);
