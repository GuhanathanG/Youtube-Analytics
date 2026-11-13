import { compact } from "@/lib/format";
import { logPos } from "@/lib/viz-math";
import { multColor } from "./tokens";

/**
 * A forecast as a shape: the likely range (low–high) as a glowing bar on a shared log scale, a dot for
 * the expected 30-day views and a white tick for the views so far. Wider bar = less sure.
 */
export function RangeBar({ low, high, expected, now, vsNormal, lo, hi }:
  { low: number; high: number; expected: number; now: number | null; vsNormal: number; lo: number; hi: number }) {
  const a = logPos(low, lo, hi) * 100, b = logPos(high, lo, hi) * 100, e = logPos(expected, lo, hi) * 100;
  const n = now && now > 0 ? logPos(now, lo, hi) * 100 : null;
  const c = multColor(vsNormal);
  return (
    <div className="relative h-6 min-w-[160px]" role="img" aria-label={`Expected ${compact(expected)} views in 30 days, likely ${compact(low)} to ${compact(high)}`}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
      <div className="grow-x absolute top-1/2 h-2 -translate-y-1/2 rounded-full" title={`${compact(low)}–${compact(high)}`}
        style={{ left: `${a}%`, width: `${Math.max(1.5, b - a)}%`, background: `linear-gradient(90deg, ${c}33, ${c}aa, ${c}33)`, boxShadow: `0 0 12px -3px ${c}` }} />
      {n !== null && <div className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-white/80" style={{ left: `${n}%` }} title={`${compact(now)} views now`} />}
      <div className="viz-pop absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#05070d]"
        style={{ left: `${e}%`, background: c, boxShadow: `0 0 8px ${c}` }} title={`${compact(expected)} expected`} />
    </div>
  );
}
