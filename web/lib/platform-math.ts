/**
 * YouTube vs Instagram side by side (no app imports: tested in tests/logic.test.ts).
 * Works on outlier-scored uploads (see outlier-math.ts), so "how well" always means "vs that account's own normal".
 */
import { median } from "./analytics-math.ts";
import type { Scored } from "./outlier-math.ts";

/** India time (the audience) from a UTC timestamp string. */
export function istParts(iso: string): { day: number; hour: number } {
  const d = new Date(iso.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z"));
  const t = new Date(d.getTime() + 5.5 * 3600_000);
  return { day: (t.getUTCDay() + 6) % 7, hour: t.getUTCHours() }; // day 0 = Monday
}

export const SLOTS = [{ label: "Night", from: 0, to: 6 }, { label: "Morning", from: 6, to: 12 }, { label: "Afternoon", from: 12, to: 17 },
  { label: "Evening", from: 17, to: 22 }, { label: "Late", from: 22, to: 24 }];
export const slotOf = (hour: number) => SLOTS.findIndex((s) => hour >= s.from && hour < s.to);

/** 7 days × 5 time slots: median score of uploads posted then (null = fewer than `min` uploads). */
export function timingGrid(xs: Scored[], min = 2): (number | null)[][] {
  const cells: number[][][] = Array.from({ length: 7 }, () => SLOTS.map(() => []));
  for (const v of xs) { const { day, hour } = istParts(v.published_at); cells[day][slotOf(hour)].push(v.score); }
  return cells.map((row) => row.map((c) => (c.length >= min ? median(c) : null)));
}

/** The best day + slot (highest median score with enough uploads). */
export function bestSlot(grid: (number | null)[][]): { day: number; slot: number; score: number } | null {
  let best: { day: number; slot: number; score: number } | null = null;
  grid.forEach((row, day) => row.forEach((s, slot) => { if (s !== null && (!best || s > best.score)) best = { day, slot, score: s }; }));
  return best;
}

/** Median (likes + comments) per view, as a share. Uploads without views are skipped. */
export function engagementRate(xs: Scored[]): number | null {
  return median(xs.filter((v) => (v.view_count ?? 0) > 0).map((v) => ((v.like_count ?? 0) + (v.comment_count ?? 0)) / (v.view_count ?? 1)));
}

export type Idea = { from: Scored; to: "youtube" | "instagram"; why: string };
/**
 * What to repurpose: Instagram reels that broke out (2×+) → make a Short; YouTube Shorts that broke out → post
 * as a reel; long videos that broke out → cut a reel from them. Strongest first.
 */
export function repurposeIdeas(yt: Scored[], ig: Scored[], recentDays = 120, limit = 6): Idea[] {
  const fresh = (v: Scored) => v.age <= recentDays && v.score >= 2;
  const ideas: Idea[] = [
    ...ig.filter((v) => v.kind === "reel" && fresh(v)).map((v) => ({ from: v, to: "youtube" as const, why: "Reel that broke out: post it as a Short" })),
    ...yt.filter((v) => v.kind === "short" && fresh(v)).map((v) => ({ from: v, to: "instagram" as const, why: "Short that broke out: post it as a reel" })),
    ...yt.filter((v) => v.kind === "long" && fresh(v)).map((v) => ({ from: v, to: "instagram" as const, why: "Long video that broke out: cut its best minute into a reel" })),
  ];
  return ideas.sort((a, b) => b.from.score - a.from.score).slice(0, limit);
}
