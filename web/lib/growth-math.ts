/**
 * Goals & milestones and change-effect maths (no app imports: tested in tests/logic.test.ts).
 */
export type Point = { t: number; v: number }; // t = ms since epoch

/** Growth per day: least-squares slope over the points (needs 2+ points spanning 12+ hours). */
export function pacePerDay(points: Point[]): number | null {
  const ps = points.filter((p) => Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
  if (ps.length < 2 || ps[ps.length - 1].t - ps[0].t < 12 * 3600_000) return null;
  const n = ps.length, mt = ps.reduce((s, p) => s + p.t, 0) / n, mv = ps.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of ps) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) ** 2; }
  return den ? (num / den) * 86400_000 : null;
}

export type GoalView = { current: number; target: number; progress: number; pace: number | null; etaDays: number | null;
  needPerDay: number | null; onTrack: boolean | null; reached: boolean };

/** Where a goal stands: progress, predicted days to reach it at the current pace, and the pace a deadline needs. */
export function goalView(current: number, target: number, pace: number | null, deadline: Date | null, now = new Date()): GoalView {
  const reached = current >= target;
  const left = Math.max(0, target - current);
  const etaDays = reached ? 0 : pace && pace > 0 ? left / pace : null;
  const daysToDeadline = deadline ? (deadline.getTime() - now.getTime()) / 86400_000 : null;
  const needPerDay = !reached && daysToDeadline !== null && daysToDeadline > 0 ? left / daysToDeadline : null;
  const onTrack = reached ? true : needPerDay === null ? null : pace !== null ? pace >= needPerDay : false;
  return { current, target, progress: target > 0 ? Math.min(1, current / target) : 0, pace, etaDays, needPerDay, onTrack, reached };
}

/** Views per hour in a window before and after a moment, from a video's view snapshots. Null when not enough points. */
export function rateAround(points: Point[], at: number, windowH = 48): { before: number | null; after: number | null; lift: number | null } {
  const rate = (from: number, to: number) => {
    const inside = points.filter((p) => p.t >= from && p.t <= to).sort((a, b) => a.t - b.t);
    if (inside.length < 2) return null;
    const a = inside[0], b = inside[inside.length - 1];
    const hours = (b.t - a.t) / 3600_000;
    return hours >= 2 ? Math.max(0, (b.v - a.v) / hours) : null;
  };
  const before = rate(at - windowH * 3600_000, at), after = rate(at, at + windowH * 3600_000);
  return { before, after, lift: before && after !== null && before > 0 ? after / before : null };
}
