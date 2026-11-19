"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TimeBrush, type Window } from "./TimeBrush";

export type Kind = "bar" | "line" | "area";
export type Series = {
  key: string; label: string; color: string; values: (number | null)[];
  /** "right" puts the series on a second axis (always drawn as a line). */
  axis?: "right";
  /** How the legend sums the chosen period: total, average, or latest value (with change). */
  agg?: "sum" | "avg" | "last";
  /** Shown only in the hover read-out (not drawn). */
  tipOnly?: boolean;
};
export type Marker = { i: number; label: string; color: string; href?: string; tag?: string; shape?: "dot" | "diamond" };
type Unit = "day" | "week" | "month";

const nf = new Intl.NumberFormat("en");
export const compactNum = (v: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/** Round axis ticks covering [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

function guessUnit(x: string[]): Unit {
  if (x.length < 2) return "day";
  if (/^\d{4}-\d{2}$/.test(x[0])) return "month";
  const gap = (Date.parse(x[1].slice(0, 10)) - Date.parse(x[0].slice(0, 10))) / 86400000;
  return gap >= 27 ? "month" : gap >= 6 ? "week" : "day";
}
const toDate = (s: string) => new Date(/^\d{4}-\d{2}$/.test(s) ? `${s}-01T00:00:00Z` : `${s.slice(0, 10)}T00:00:00Z`);
const fmt = (s: string, unit: Unit, long = false) => {
  const d = toDate(s);
  if (unit === "month") return d.toLocaleDateString("en-GB", { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(long ? { year: "numeric" } : {}), timeZone: "UTC" });
};
const periodName = (unit: Unit, x: string) => (unit === "week" ? `Week of ${fmt(x, "day", true)}` : fmt(x, unit, true));

/**
 * The Signal time chart: labelled value axis (and an optional second axis on the right), date axis, gridlines,
 * a legend that totals the chosen period (click a key to hide it), a hover/tap read-out with every value, a
 * Bars / Lines / Area switch, and a timeline slider underneath to pick any stretch of time.
 */
export function SigChart({
  x, series, kind = "bar", kinds, stacked = true, height = 300, unit: unitIn, yLabel, rightLabel, yFormat = compactNum,
  rightFormat = compactNum, domain, zero = true, refLine, markers = [], brush = true, defaultSpan, ariaLabel, keyClass = "", showTotal,
}: {
  x: string[]; series: Series[]; kind?: Kind; kinds?: Kind[]; stacked?: boolean; height?: number; unit?: Unit; yLabel?: string; rightLabel?: string;
  yFormat?: (v: number) => string; rightFormat?: (v: number) => string; domain?: [number, number]; zero?: boolean; refLine?: { y: number; label: string };
  markers?: Marker[]; brush?: boolean; defaultSpan?: number; ariaLabel: string; keyClass?: string; showTotal?: boolean;
}) {
  const n = x.length;
  const unit = unitIn ?? guessUnit(x);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(820);
  const [view, setView] = useState<Kind>(kind);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [win, setWin] = useState<Window>([defaultSpan && defaultSpan < n ? n - defaultSpan : 0, Math.max(0, n - 1)]);
  const [hover, setHover] = useState<number | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);
  // A new data set (e.g. a different range tab) resets the window.
  useEffect(() => { setWin([defaultSpan && defaultSpan < n ? n - defaultSpan : 0, Math.max(0, n - 1)]); }, [n, defaultSpan]);

  const [a, b] = [Math.min(win[0], n - 1), Math.min(win[1], n - 1)];
  const drawn = series.filter((s) => !s.tipOnly);
  const tipOnly = series.filter((s) => s.tipOnly);
  const left = drawn.filter((s) => s.axis !== "right" && !hidden.has(s.key));
  const right = drawn.filter((s) => s.axis === "right" && !hidden.has(s.key));
  const idx = useMemo(() => Array.from({ length: b - a + 1 }, (_, k) => a + k), [a, b]);
  const stack = stacked && view !== "line";

  const narrow = w < 520;
  const M = { l: narrow ? 40 : 56, r: right.length ? (narrow ? 40 : 56) : 14, t: markers.length ? 30 : 12, b: 30 };
  const iw = w - M.l - M.r, ih = height - M.t - M.b;

  const yDom = useMemo(() => {
    if (domain) return domain;
    let lo = Infinity, hi = -Infinity;
    for (const i of idx) {
      if (stack) { const s = left.reduce((t, se) => t + Math.max(0, se.values[i] ?? 0), 0); hi = Math.max(hi, s); lo = Math.min(lo, s); }
      for (const se of left) { const v = se.values[i]; if (v === null || v === undefined) continue; hi = Math.max(hi, v); lo = Math.min(lo, v); }
    }
    if (!Number.isFinite(hi)) return [0, 1] as [number, number];
    if (zero) lo = Math.min(0, lo);
    else { const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1; lo -= pad; hi += pad * 0.5; }
    return [lo, hi] as [number, number];
  }, [domain, idx, left, stack, zero]);
  const yT = niceTicks(yDom[0], yDom[1], ih < 200 ? 4 : 5).filter((t) => domain ? t >= domain[0] && t <= domain[1] : true);
  const y0 = domain ? domain[0] : yT[0], y1 = domain ? domain[1] : yT[yT.length - 1];
  const Y = (v: number) => M.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  const rMax = Math.max(1, ...idx.flatMap((i) => right.map((s) => s.values[i] ?? 0)));
  const rT = niceTicks(0, rMax, ih < 200 ? 4 : 5);
  const YR = (v: number) => M.t + ih - (v / (rT[rT.length - 1] || 1)) * ih;

  const m = idx.length, slot = iw / Math.max(1, m);
  const X = (k: number) => M.l + slot * (k + 0.5);
  const xEvery = Math.max(1, Math.ceil(m / Math.max(2, Math.floor(iw / (unit === "month" ? 56 : 66)))));

  // Geometry
  const bars: { k: number; s: Series; x: number; y: number; w: number; h: number }[] = [];
  const paths: { s: Series; d: string; area?: string; right?: boolean }[] = [];
  if (view === "bar") {
    const bw = Math.min(28, slot * 0.72);
    idx.forEach((i, k) => {
      if (stack) {
        let acc = 0;
        for (const s of left) { const v = Math.max(0, s.values[i] ?? 0); if (!v) continue; bars.push({ k, s, x: X(k) - bw / 2, y: Y(acc + v), w: bw, h: Y(acc) - Y(acc + v) }); acc += v; }
      } else {
        const g = bw / Math.max(1, left.length);
        left.forEach((s, j) => { const v = s.values[i]; if (v === null || v === undefined) return; const base = Y(Math.max(y0, 0)), top = Y(v); bars.push({ k, s, x: X(k) - bw / 2 + j * g, y: Math.min(base, top), w: Math.max(1, g - 1), h: Math.abs(base - top) }); });
      }
    });
  } else {
    const acc = idx.map(() => 0);
    for (const s of left) {
      let d = "", pen = false; const top: [number, number][] = [], bot: [number, number][] = [];
      idx.forEach((i, k) => {
        const v = s.values[i];
        if (v === null || v === undefined) { pen = false; return; }
        const base = stack ? acc[k] : 0, val = stack ? base + Math.max(0, v) : v;
        d += `${pen ? "L" : "M"}${X(k).toFixed(1)},${Y(val).toFixed(1)}`; pen = true;
        top.push([X(k), Y(val)]); bot.push([X(k), Y(stack ? base : Math.max(y0, 0))]);
        if (stack) acc[k] = val;
      });
      const area = view === "area" && top.length > 1 ? `M${top.map((p) => p.join(",")).join("L")}L${bot.reverse().map((p) => p.join(",")).join("L")}Z` : undefined;
      paths.push({ s, d, area });
    }
  }
  for (const s of right) {
    let d = "", pen = false;
    idx.forEach((i, k) => { const v = s.values[i]; if (v === null || v === undefined) { pen = false; return; } d += `${pen ? "L" : "M"}${X(k).toFixed(1)},${YR(v).toFixed(1)}`; pen = true; });
    paths.push({ s, d, right: true });
  }

  const summary = (s: Series) => {
    const vals = idx.map((i) => s.values[i]).filter((v): v is number => v !== null && v !== undefined);
    if (!vals.length) return "–";
    const f = s.axis === "right" ? rightFormat : yFormat;
    if (s.agg === "avg") return `avg ${f(Math.round((vals.reduce((p, c) => p + c, 0) / vals.length) * 10) / 10)}`;
    if (s.agg === "last") { const ch = vals[vals.length - 1] - vals[0]; return `${f(vals[vals.length - 1])} (${ch >= 0 ? "+" : "−"}${f(Math.abs(ch))})`; }
    return `${nf.format(Math.round(vals.reduce((p, c) => p + c, 0)))} total`;
  };
  const brushVals = useMemo(() => x.map((_, i) => series.filter((s) => s.axis !== "right" && !s.tipOnly).reduce((t, s) => t + Math.abs(s.values[i] ?? 0), 0)), [x, series]);
  const hi = hover !== null ? idx[hover] : null;
  const tipLeft = hover !== null ? X(hover) : 0;
  const visMarkers = markers.filter((mk) => mk.i >= a && mk.i <= b);

  if (!n) return <div className="mono py-16 text-center">No data in this range yet</div>;
  return (
    <div className="sigchart">
      {/* Legend: what each colour is, with its total for the chosen period. Click to hide or show. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2" role="group" aria-label="Series">
          {drawn.map((s) => (
            <button key={s.key} type="button" onClick={() => setHidden((h) => { const c = new Set(h); if (c.has(s.key)) c.delete(s.key); else c.add(s.key); return c; })}
              className={`${keyClass}${s.key} flex items-center gap-2 text-left text-[12.5px] transition ${hidden.has(s.key) ? "opacity-35 line-through" : ""}`} aria-pressed={!hidden.has(s.key)}>
              <span className={s.axis === "right" ? "h-0.5 w-4" : "h-2.5 w-2.5"} style={{ background: s.color }} />
              <span className="text-ink-2">{s.label}{s.axis === "right" && rightLabel ? <span className="text-ink-3"> (right axis)</span> : null}</span>
              <span className="font-mono text-[11px] tabular text-ink">{summary(s)}</span>
            </button>
          ))}
        </div>
        {(kinds?.length ?? 0) > 1 && (
          <div className="flex gap-1 rounded-full border border-line-2 p-0.5" role="group" aria-label="Chart type">
            {kinds!.map((k) => (
              <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
                className={`rounded-full px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] transition ${view === k ? "bg-ink text-bg" : "text-ink-3 hover:text-ink"}`}>
                {k === "bar" ? "Bars" : k === "line" ? "Lines" : "Area"}</button>
            ))}
          </div>
        )}
      </div>

      <div ref={box} className="relative w-full" style={{ height }}>
        <svg width={w} height={height} className={`absolute inset-0 block ${shown ? "sc-in" : ""}`} role="img" aria-label={ariaLabel}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const k = Math.floor((e.clientX - r.left - M.l) / slot); setHover(k >= 0 && k < m ? k : null); }}>
          {/* value axis + gridlines */}
          {yT.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.l} x2={w - M.r} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.07)"} />
              <text x={M.l - 8} y={Y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="#8a8a93" fontFamily="var(--f-mono)">{yFormat(t)}</text>
            </g>
          ))}
          {right.length > 0 && rT.map((t) => <text key={`r${t}`} x={w - M.r + 8} y={YR(t) + 3.5} fontSize={10.5} fill="#8a8a93" fontFamily="var(--f-mono)">{rightFormat(t)}</text>)}
          {yLabel && <text x={12} y={M.t + ih / 2} fontSize={10} fill="#8a8a93" fontFamily="var(--f-mono)" textAnchor="middle" transform={`rotate(-90 12 ${M.t + ih / 2})`} letterSpacing="1">{yLabel.toUpperCase()}</text>}
          {rightLabel && right.length > 0 && <text x={w - 6} y={M.t + ih / 2} fontSize={10} fill="#8a8a93" fontFamily="var(--f-mono)" textAnchor="middle" transform={`rotate(90 ${w - 6} ${M.t + ih / 2})`} letterSpacing="1">{rightLabel.toUpperCase()}</text>}
          {refLine && refLine.y > y0 && refLine.y < y1 && (
            <g><line x1={M.l} x2={w - M.r} y1={Y(refLine.y)} y2={Y(refLine.y)} stroke="#ededea" strokeOpacity={0.45} strokeDasharray="4 4" />
              <text x={w - M.r - 4} y={Y(refLine.y) - 5} textAnchor="end" fontSize={10} fill="#ededea" fontFamily="var(--f-mono)">{refLine.label}</text></g>
          )}
          {/* date axis */}
          {idx.map((i, k) => (k % xEvery === 0 || k === m - 1) && (m - 1 - k >= xEvery * 0.6 || k === m - 1) ? (
            <g key={`x${i}`}>
              <line x1={X(k)} x2={X(k)} y1={M.t + ih} y2={M.t + ih + 4} stroke="rgba(255,255,255,.3)" />
              <text x={X(k)} y={height - 10} textAnchor={k === 0 ? "start" : k === m - 1 ? "end" : "middle"} fontSize={10.5} fill="#8a8a93" fontFamily="var(--f-mono)"
                dx={k === 0 ? -4 : k === m - 1 ? 4 : 0}>{fmt(x[i], unit)}</text>
            </g>
          ) : null)}
          {/* hover column */}
          {hover !== null && <rect x={X(hover) - slot / 2} y={M.t} width={slot} height={ih} fill="rgba(255,255,255,.05)" />}
          {/* data */}
          <g className="sc-bars">
            {bars.map((r, j) => (
              <rect key={j} x={r.x} y={r.y} width={r.w} height={Math.max(0, r.h)} fill={r.s.color} opacity={hover === null || hover === r.k ? 1 : 0.45}
                style={{ transformOrigin: `0 ${M.t + ih}px`, transitionDelay: `${(r.k / Math.max(1, m)) * 500}ms` }} />
            ))}
          </g>
          {paths.map((p) => (
            <g key={p.s.key}>
              {p.area && <g className="sc-fade"><path d={p.area} fill={p.s.color} opacity={stack ? 0.75 : 0.18} /></g>}
              <path d={p.d} fill="none" stroke={p.s.color} strokeWidth={p.right ? 2 : 1.8} strokeLinejoin="round" pathLength={1} className="sc-line" />
              {/* points: always for short series, and for any point with no neighbour (it would not draw as a line) */}
              {view !== "bar" || p.right ? idx.map((i, k) => {
                const v = p.s.values[i]; if (v === null || v === undefined) return null;
                const lone = (p.s.values[i - 1] ?? null) === null && (p.s.values[i + 1] ?? null) === null;
                if (!lone && m > 40) return null;
                if (!p.right && stack) return null;
                return <circle key={i} cx={X(k)} cy={p.right ? YR(v) : Y(v)} r={lone ? 3.5 : 2.2} fill={p.s.color} className="sc-fade" />;
              }) : null}
            </g>
          ))}
          {hover !== null && hi !== null && [...left.filter(() => view !== "bar"), ...right].map((s) => {
            const v = s.values[hi]; if (v === null || v === undefined) return null;
            let yy = s.axis === "right" ? YR(v) : Y(v);
            if (s.axis !== "right" && stack) { let acc = 0; for (const q of left) { acc += Math.max(0, q.values[hi] ?? 0); if (q.key === s.key) break; } yy = Y(acc); }
            return <circle key={s.key} cx={X(hover)} cy={yy} r={4} fill={s.color} stroke="#07070a" strokeWidth={2} />;
          })}
          {/* event markers above the plot */}
          {visMarkers.map((mk, j) => {
            const k = mk.i - a, cx = X(k), cy = 13;
            const shape = mk.shape === "diamond"
              ? <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={mk.color} transform={`rotate(45 ${cx} ${cy})`} />
              : <circle cx={cx} cy={cy} r={6} fill={mk.color} />;
            const g = (
              <g className="sc-marker">
                <title>{mk.label}</title>
                <line x1={cx} x2={cx} y1={cy + 6} y2={M.t + ih} stroke={mk.color} strokeOpacity={0.3} strokeDasharray="2 3" />
                {shape}
                {mk.tag && <text x={cx} y={cy + 3.2} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="#07070a">{mk.tag}</text>}
              </g>
            );
            return mk.href ? <Link key={j} href={mk.href}>{g}</Link> : <g key={j}>{g}</g>;
          })}
        </svg>

        {/* hover read-out */}
        {hover !== null && hi !== null && (
          <div className="pointer-events-none absolute z-10 min-w-[170px] border px-3 py-2.5 text-[12px]"
            style={{ top: M.t, left: tipLeft > w * 0.6 ? undefined : tipLeft + 14, right: tipLeft > w * 0.6 ? w - tipLeft + 14 : undefined, background: "rgba(7,7,10,.94)", borderColor: "var(--hair-2)" }}>
            <div className="font-mono text-[11px] text-ink">{periodName(unit, x[hi])}</div>
            <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
              {[...left, ...right, ...tipOnly].map((s) => {
                const v = s.values[hi]; const tot = left.reduce((t, q) => t + Math.max(0, q.values[hi] ?? 0), 0);
                return [
                  <span key={`${s.key}l`} className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2" style={{ background: s.color }} />{s.label}</span>,
                  <span key={`${s.key}v`} className="text-right tabular text-ink">{v === null || v === undefined ? "–" : (s.axis === "right" ? rightFormat : yFormat === compactNum ? (q: number) => nf.format(Math.round(q * 100) / 100) : yFormat)(v)}
                    {(showTotal ?? stacked) && s.axis !== "right" && !s.tipOnly && tot > 0 && v ? <span className="ml-1.5 text-ink-3">{Math.round((v / tot) * 100)}%</span> : null}</span>,
                ];
              })}
              {(showTotal ?? stacked) && left.length > 1 && <>
                <span className="mt-1 border-t border-line pt-1 text-ink-3">total</span>
                <span className="mt-1 border-t border-line pt-1 text-right tabular text-ink">{nf.format(Math.round(left.reduce((t, q) => t + Math.max(0, q.values[hi] ?? 0), 0)))}</span>
              </>}
            </div>
            {visMarkers.filter((mk) => mk.i === hi).map((mk, j) => <div key={j} className="mt-1.5 max-w-[260px] text-[11.5px]" style={{ color: mk.color }}>● {mk.label}</div>)}
          </div>
        )}
      </div>

      {brush && n > 8 && <TimeBrush values={brushVals} labels={x.map((d) => unit === "week" ? `wk ${fmt(d, "day", true)}` : fmt(d, unit, true))} value={[a, b]} onChange={setWin}
        unit={unit === "day" ? "days" : unit === "week" ? "weeks" : "months"} presets={unit === "month" ? [3, 6, 12] : unit === "week" ? [4, 12, 26] : [7, 30, 90]} />}
    </div>
  );
}
