"use client";
import { useMemo, useState } from "react";

export type Window = [number, number]; // inclusive indexes into the series

/**
 * Pick any stretch of a time series: a mini preview of the whole period with two handles (drag either end, or drag the
 * shaded window to slide it), quick buttons for the last 7 / 30 / 90 points and All, and the chosen dates in words.
 * Two native range inputs underneath, so it works with mouse, touch and keyboard.
 */
export function TimeBrush({ values, labels, value, onChange, unit = "days", presets = [7, 30, 90] }: {
  values: number[]; labels: string[]; value: Window; onChange: (w: Window) => void; unit?: string; presets?: number[];
}) {
  const n = values.length;
  const [drag, setDrag] = useState<{ x: number; w: Window } | null>(null);
  const W = 1000, H = 40;
  const path = useMemo(() => {
    const max = Math.max(1, ...values);
    const pts = values.map((v, i) => `${n === 1 ? 0 : (i / (n - 1)) * W},${H - (v / max) * (H - 4)}`);
    return `M0,${H} L${pts.join(" L")} L${W},${H} Z`;
  }, [values, n]);
  if (n < 2) return null;
  const [a, b] = value;
  const pct = (i: number) => (i / (n - 1)) * 100;
  const set = (x: number, y: number) => onChange([Math.max(0, Math.min(x, y)), Math.min(n - 1, Math.max(x, y))]);
  const span = b - a + 1;
  return (
    <div className="mt-5 select-none" data-brush="">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-2" aria-live="polite">
          <span className="text-accent">{labels[a]}</span> → <span className="text-accent">{labels[b]}</span> · {span} {unit}
        </div>
        <div className="flex gap-1 rounded-full border border-line-2 p-0.5" role="group" aria-label="Quick periods">
          {presets.filter((p) => p < n).map((p) => (
            <button key={p} type="button" onClick={() => set(n - p, n - 1)}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[10.5px] transition ${a === n - p && b === n - 1 ? "bg-accent text-bg" : "text-ink-3 hover:text-ink"}`}>{p}</button>
          ))}
          <button type="button" onClick={() => set(0, n - 1)}
            className={`rounded-full px-2.5 py-0.5 font-mono text-[10.5px] transition ${a === 0 && b === n - 1 ? "bg-accent text-bg" : "text-ink-3 hover:text-ink"}`}>All</button>
        </div>
      </div>
      <div className="brush relative h-10">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <path d={path} fill="rgba(255,255,255,.08)" />
        </svg>
        {/* the chosen window: drag it to slide the whole period */}
        <div className="absolute inset-y-0 cursor-grab border-x-2 border-accent bg-accent/[0.12] active:cursor-grabbing"
          style={{ left: `${pct(a)}%`, width: `${Math.max(0.5, pct(b) - pct(a))}%` }}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ x: e.clientX, w: value }); }}
          onPointerMove={(e) => {
            if (!drag) return;
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const shift = Math.round(((e.clientX - drag.x) / box.width) * (n - 1));
            const len = drag.w[1] - drag.w[0];
            const s = Math.max(0, Math.min(n - 1 - len, drag.w[0] + shift));
            onChange([s, s + len]);
          }}
          onPointerUp={() => setDrag(null)} />
        <input type="range" min={0} max={n - 1} value={a} aria-label={`Start: ${labels[a]}`} onChange={(e) => set(Number(e.target.value), b)} className="brush-range" />
        <input type="range" min={0} max={n - 1} value={b} aria-label={`End: ${labels[b]}`} onChange={(e) => set(a, Number(e.target.value))} className="brush-range" />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-ink-3"><span>{labels[0]}</span><span>{labels[n - 1]}</span></div>
    </div>
  );
}

/** Nice axis ticks for 0..max (about `count` of them). */
export function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export const short = (v: number) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`);

/** Date label for "YYYY-MM-DD" (UTC), e.g. "12 Sep" or "12 Sep 26". */
export const dayLabel = (d: string, year = false) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "2-digit" } : {}), timeZone: "UTC" });
