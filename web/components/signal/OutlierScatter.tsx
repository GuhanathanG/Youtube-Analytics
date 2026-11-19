"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TimeBrush, type Window } from "./TimeBrush";

type V = { id: string; title: string; outlier: number | null; views: number; date: string | null; channel?: string };
const mult = (x: number) => `${x >= 10 ? Math.round(x) : x.toFixed(1)}×`;
const DAY = 86400000;
const colorOf = (x: number) => (x >= 2 ? "#ff3d7f" : x >= 1 ? "#22e1ff" : "#6b6b75");

/**
 * Every upload as a dot: across = when it was published, up = views as a multiple of its channel's usual (log scale,
 * so 2× and ½× sit the same distance from the "usual" line). Magenta = breakout (2×+), cyan = at or above usual,
 * grey = below. Hover a dot for the title and numbers, click to open it; the slider picks the period.
 */
export function OutlierScatter({ videos, height = 360 }: { videos: V[]; height?: number }) {
  const items = useMemo(() => videos.filter((v) => v.date && v.outlier !== null && Number.isFinite(v.outlier) && v.outlier > 0)
    .map((v) => ({ ...v, t: Date.parse(v.date!) })).sort((a, b) => a.t - b.t), [videos]);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(820);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width)))); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Weekly bins for the slider.
  const t0 = items[0]?.t ?? 0, t1 = items[items.length - 1]?.t ?? 0;
  const nb = Math.max(1, Math.ceil((t1 - t0) / (7 * DAY)) + 1);
  const bins = useMemo(() => { const c = Array(nb).fill(0); for (const v of items) c[Math.floor((v.t - t0) / (7 * DAY))]++; return c as number[]; }, [items, nb, t0]);
  const binLabel = (i: number) => new Date(t0 + i * 7 * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const [win, setWin] = useState<Window>([0, nb - 1]);
  useEffect(() => setWin([0, nb - 1]), [nb]);

  if (!items.length) return <div className="mono py-16 text-center">No scored uploads yet</div>;
  const lo = t0 + win[0] * 7 * DAY, hi = t0 + (win[1] + 1) * 7 * DAY;
  const shown = items.filter((v) => v.t >= lo && v.t < hi);
  const M = { l: 48, r: 14, t: 14, b: 30 }, iw = w - M.l - M.r, ih = height - M.t - M.b;
  // Fit the log scale to the uploads shown (at least ½× … 4×, at most ⅛× … 32×).
  const lg = shown.map((v) => Math.log2(v.outlier!));
  const yLo = Math.max(-3, Math.min(-1, Math.floor(Math.min(0, ...lg)))), yHi = Math.min(5, Math.max(2, Math.ceil(Math.max(1, ...lg))));
  const L = (x: number) => Math.max(yLo, Math.min(yHi, Math.log2(x)));
  const Y = (x: number) => M.t + ih - ((L(x) - yLo) / (yHi - yLo)) * ih;
  const X = (t: number) => M.l + ((t - lo) / Math.max(DAY, hi - lo)) * iw;
  const yT = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32].filter((t) => Math.log2(t) >= yLo && Math.log2(t) <= yHi);
  const span = (hi - lo) / DAY, monthly = span > 120;
  const xT: number[] = [];
  const maxTicks = Math.max(2, Math.floor(iw / 72));
  { const d = new Date(lo); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    const stepM = [1, 2, 3, 6, 12].find((s) => span / 30.4 / s <= maxTicks) ?? 12;
    if (monthly) { for (let k = 0; k < 60; k++) { const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k * stepM, 1); if (t > hi) break; if (t >= lo) xT.push(t); } }
    else { const step = [7, 14, 28].find((s) => span / s <= maxTicks) ?? 28; for (let t = lo; t < hi; t += step * DAY) xT.push(t); } }
  const breakouts = shown.filter((v) => v.outlier! >= 2).length, above = shown.filter((v) => v.outlier! >= 1).length;
  const h = shown.find((v) => v.id === hover);
  const dens = Math.min(1, Math.sqrt((iw * ih) / Math.max(1, shown.length) / 900)); // smaller dots when crowded
  const r = (v: { views: number }) => Math.max(2, Math.min(9, 2 + Math.log10(Math.max(10, v.views))) * dens);

  return (
    <figure className="outlier-scatter w-full">
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-ink-3">
        <span><span style={{ color: "#ff3d7f" }}>●</span> breakout 2×+ <span className="text-ink">{breakouts}</span></span>
        <span><span style={{ color: "#22e1ff" }}>●</span> at or above usual <span className="text-ink">{above - breakouts}</span></span>
        <span><span style={{ color: "#6b6b75" }}>●</span> below usual <span className="text-ink">{shown.length - above}</span></span>
        <span>dot size = views</span>
      </div>
      <div ref={box} className="relative w-full" style={{ height }}>
        <svg width={w} height={height} className="absolute inset-0 overflow-visible" role="img"
          aria-label={`${shown.length} uploads by date and views versus usual; ${breakouts} breakouts at 2× or more`}>
          {yT.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={w - M.r} y1={Y(t)} y2={Y(t)} stroke={t === 1 ? "rgba(237,237,234,.5)" : t === 2 ? "rgba(255,61,127,.35)" : "rgba(255,255,255,.06)"} strokeDasharray={t === 1 || t === 2 ? "4 4" : undefined} />
              <text x={M.l - 8} y={Y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="#8a8a93" fontFamily="var(--f-mono)">{t < 1 ? `1/${1 / t}×` : `${t}×`}</text>
            </g>
          ))}
          <text x={w - M.r - 4} y={Y(1) - 5} textAnchor="end" fontSize={10} fill="#ededea" fontFamily="var(--f-mono)">USUAL</text>
          <text x={w - M.r - 4} y={Y(2) - 5} textAnchor="end" fontSize={10} fill="#ff3d7f" fontFamily="var(--f-mono)">BREAKOUT 2×</text>
          <text x={12} y={M.t + ih / 2} fontSize={10} fill="#8a8a93" fontFamily="var(--f-mono)" textAnchor="middle" transform={`rotate(-90 12 ${M.t + ih / 2})`} letterSpacing="1">VIEWS VS USUAL</text>
          {xT.map((t) => (
            <text key={t} x={X(t)} y={height - 10} textAnchor="middle" fontSize={10.5} fill="#8a8a93" fontFamily="var(--f-mono)">
              {new Date(t).toLocaleDateString("en-GB", monthly ? { month: "short", year: "2-digit", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" })}</text>
          ))}
          {shown.map((v, i) => (
            <Link key={v.id} href={`/videos/${v.id}`} className="sc-dot" onPointerEnter={() => setHover(v.id)} onPointerLeave={() => setHover(null)}>
              <title>{`${v.title} · ${mult(v.outlier!)} usual · ${v.views.toLocaleString("en")} views`}</title>
              <circle cx={X(v.t)} cy={Y(v.outlier!)} r={r(v)} fill={colorOf(v.outlier!)} fillOpacity={hover && hover !== v.id ? 0.25 : 0.85}
                stroke={hover === v.id ? "#fff" : "#07070a"} strokeWidth={hover === v.id ? 2 : 1} className="sc-pop" style={{ animationDelay: `${Math.min(900, i * 4)}ms` }} />
            </Link>
          ))}
        </svg>
        {h && (
          <div className="pointer-events-none absolute z-10 max-w-[280px] border px-3 py-2.5 text-[12px]"
            style={{ top: Math.max(0, Y(h.outlier!) - 70), ...(X(h.t) > w * 0.6 ? { right: w - X(h.t) + 14 } : { left: X(h.t) + 14 }), background: "rgba(7,7,10,.94)", borderColor: "var(--hair-2)" }}>
            <div className="text-ink">{h.title}</div>
            <div className="mt-1 font-mono text-[11px] text-ink-3">{new Date(h.t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}{h.channel ? ` · ${h.channel}` : ""}</div>
            <div className="mt-1.5 flex gap-4 tabular"><span style={{ color: colorOf(h.outlier!) }}>{mult(h.outlier!)} usual</span><span>{h.views.toLocaleString("en")} views</span></div>
          </div>
        )}
      </div>
      {nb > 3 && <TimeBrush values={bins} labels={bins.map((_, i) => binLabel(i))} value={win} onChange={setWin} unit="weeks" presets={[4, 12, 26, 52]} />}
    </figure>
  );
}
