/**
 * Pure geometry for the Phase 4 visuals (mood river, gauge, forecast range bar, goal track).
 * No imports, so the unit tests can load it directly.
 */

export type MoodDay = { day: string; positive: number; neutral: number; negative: number; pending: number };
export const MOOD_KEYS = ["positive", "neutral", "negative", "pending"] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];

/** Fills missing days with zeros so the river's x axis is real time (oldest → newest, `days` long, ending today UTC). */
export function fillDays(rows: MoodDay[], days: number, today = new Date()): MoodDay[] {
  const by = new Map(rows.map((r) => [r.day, r]));
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(end - (days - 1 - i) * 86400_000).toISOString().slice(0, 10);
    const r = by.get(day);
    return { day, positive: r?.positive ?? 0, neutral: r?.neutral ?? 0, negative: r?.negative ?? 0, pending: r?.pending ?? 0 };
  });
}

/** Centred moving average (window w, odd) per mood: a river, not a seismograph. */
export function smooth(rows: MoodDay[], w = 5): MoodDay[] {
  const h = Math.floor(w / 2);
  return rows.map((r, i) => {
    const s = rows.slice(Math.max(0, i - h), i + h + 1);
    const avg = (k: MoodKey) => s.reduce((a, x) => a + x[k], 0) / s.length;
    return { day: r.day, positive: avg("positive"), neutral: avg("neutral"), negative: avg("negative"), pending: avg("pending") };
  });
}

/**
 * Streamgraph layers: each mood's band as [x, yTop, yBottom] points, centred on the middle of the chart
 * (silhouette baseline) so the river's width is the day's comment volume. Coordinates in a W×H box.
 */
export function riverLayers(rows: MoodDay[], W: number, H: number, pad = 6): Record<MoodKey, [number, number, number][]> {
  const totals = rows.map((r) => MOOD_KEYS.reduce((a, k) => a + r[k], 0));
  const max = Math.max(1, ...totals);
  const scale = (H - pad * 2) / max;
  const x = (i: number) => (rows.length <= 1 ? W / 2 : (i / (rows.length - 1)) * W);
  const out = { positive: [], neutral: [], negative: [], pending: [] } as Record<MoodKey, [number, number, number][]>;
  rows.forEach((r, i) => {
    let y = H / 2 - (totals[i] * scale) / 2;
    for (const k of MOOD_KEYS) {
      const h = r[k] * scale;
      out[k].push([x(i), y, y + h]);
      y += h;
    }
  });
  return out;
}

/** SVG path for a band: along the tops left → right, back along the bottoms right → left. */
export function bandPath(pts: [number, number, number][]): string {
  if (!pts.length) return "";
  const f = (n: number) => n.toFixed(1);
  const top = pts.map(([x, t], i) => `${i ? "L" : "M"}${f(x)},${f(t)}`).join(" ");
  const bottom = [...pts].reverse().map(([x, , b]) => `L${f(x)},${f(b)}`).join(" ");
  return `${top} ${bottom} Z`;
}

/** Position 0..1 of a value on a log scale between lo and hi (clamped). */
export function logPos(v: number, lo: number, hi: number): number {
  if (!(v > 0) || !(lo > 0) || !(hi > lo)) return 0;
  return Math.max(0, Math.min(1, (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
}

/** Gauge needle for "× usual": 0.1× at the far left, 1× straight up, 10× at the far right. Returns degrees, -90..90. */
export function gaugeAngle(index: number): number {
  return -90 + logPos(index, 0.1, 10) * 180;
}

/** A shared log scale for a set of forecast rows (low..high), padded a little so markers don't sit on the edge. */
export function forecastScale(rows: { low: number; high: number; views_now: number | null }[]): { lo: number; hi: number } {
  const vals = rows.flatMap((r) => [r.low, r.high, r.views_now ?? 0]).filter((v) => v > 0);
  if (!vals.length) return { lo: 1, hi: 10 };
  return { lo: Math.max(1, Math.min(...vals) / 1.3), hi: Math.max(...vals) * 1.3 };
}

/** The goal track: where today, the predicted date and the deadline sit on one line (0..1), plus its length in days. */
export function goalTrack(etaDays: number | null, deadlineDays: number | null): { span: number; eta: number | null; deadline: number | null } {
  const ends = [etaDays, deadlineDays].filter((d): d is number => d !== null && Number.isFinite(d) && d > 0);
  const span = Math.max(7, ...ends) * 1.08;
  const at = (d: number | null) => (d === null || !Number.isFinite(d) ? null : Math.max(0, Math.min(1, d / span)));
  return { span, eta: at(etaDays), deadline: at(deadlineDays) };
}
