"use client";
import { useMemo, useState } from "react";
import { useInView } from "./InView";

export type Day = { day: string; positive: number; neutral: number; negative: number };

/**
 * Conversation as an audio waveform: positive (cyan) and neutral (grey) rise above the axis, negative (magenta)
 * hangs below. Bars grow out of the axis left to right; a hairline "total" signal line draws itself on top;
 * hover for a crosshair read-out.
 */
export function Waveform({ days, height = 280 }: { days: Day[]; height?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 300, axis = H * 0.62;
  const { bars, line, max } = useMemo(() => {
    const max = Math.max(1, ...days.map((d) => d.positive + d.neutral), ...days.map((d) => d.negative * 1.6));
    const n = Math.max(1, days.length);
    const bw = W / n;
    const barW = Math.min(bw * 0.64, 14); // a few days of data stay slim bars, not slabs
    const up = (v: number) => (v / max) * (axis - 12);
    const down = (v: number) => (v / max) * (H - axis - 8) * 1.6;
    const bars = days.map((d, i) => ({ x: i * bw + (bw - barW) / 2, w: Math.max(1, barW), pos: up(d.positive), neu: up(d.neutral), neg: down(d.negative) }));
    // Smoothed total volume (3-day mean), as a line riding above the bars.
    const tot = days.map((d) => d.positive + d.neutral + d.negative);
    const sm = tot.map((_, i) => { const w = tot.slice(Math.max(0, i - 1), i + 2); return w.reduce((a, b) => a + b, 0) / w.length; });
    const tmax = Math.max(1, ...sm);
    const line = sm.map((v, i) => `${i ? "L" : "M"}${(i + 0.5) * bw} ${axis - 14 - (v / tmax) * (axis - 30)}`).join(" ");
    return { bars, line, max };
  }, [days, axis]);
  const h = hover !== null ? days[hover] : null;

  if (!days.length) return <div className="mono py-16 text-center">No conversation in this range yet</div>;
  return (
    <div ref={ref} className="relative select-none" style={{ height }}
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(days.length - 1, Math.floor(((e.clientX - r.left) / r.width) * days.length)))); }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-label="Comments per day by mood">
        <defs>
          <filter id="wf-glow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={axis * f} y2={axis * f} stroke="rgba(255,255,255,.05)" vectorEffect="non-scaling-stroke" />)}
        <line x1={0} x2={W} y1={axis} y2={axis} stroke="rgba(255,255,255,.18)" vectorEffect="non-scaling-stroke" />
        {bars.map((b, i) => {
          const delay = `${(i / bars.length) * 700}ms`;
          const grow = { transformOrigin: `0 ${axis}px`, transform: inView ? "scaleY(1)" : "scaleY(0)", transition: `transform .9s cubic-bezier(.2,.7,0,1) ${delay}` };
          const dim = hover !== null && hover !== i ? 0.35 : 1;
          return (
            <g key={i} style={grow} opacity={dim}>
              <rect x={b.x} y={axis - b.pos} width={b.w} height={b.pos} fill="#22e1ff" />
              <rect x={b.x} y={axis - b.pos - b.neu} width={b.w} height={b.neu} fill="#6b6b75" opacity={0.55} />
              <rect x={b.x} y={axis + 2} width={b.w} height={b.neg} fill="#ff3d7f" />
            </g>
          );
        })}
        <path d={line} fill="none" stroke="#ededea" strokeWidth={4} opacity={0.18} filter="url(#wf-glow)" vectorEffect="non-scaling-stroke" pathLength={1}
          strokeDasharray={1} strokeDashoffset={inView ? 0 : 1} style={{ transition: "stroke-dashoffset 1.8s cubic-bezier(.3,.6,0,1) .4s" }} />
        <path d={line} fill="none" stroke="#ededea" strokeWidth={1.2} vectorEffect="non-scaling-stroke" pathLength={1}
          strokeDasharray={1} strokeDashoffset={inView ? 0 : 1} style={{ transition: "stroke-dashoffset 1.8s cubic-bezier(.3,.6,0,1) .4s" }} />
        {hover !== null && <line x1={(hover + 0.5) * (W / days.length)} x2={(hover + 0.5) * (W / days.length)} y1={0} y2={H} stroke="#22e1ff" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mono pointer-events-none absolute left-0 top-0" style={{ fontSize: 10 }}>peak {max.toLocaleString("en")} / day</div>
      {h && (
        <div className="pointer-events-none absolute top-2 z-10 border px-3 py-2" style={{
          left: `${Math.min(78, Math.max(0, ((hover! + 0.5) / days.length) * 100 + 1))}%`, background: "rgba(7,7,10,.92)", borderColor: "var(--hair-2)" }}>
          <div className="mono" style={{ color: "var(--ink)" }}>{new Date(h.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
          <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 text-[12px] tab">
            <span style={{ color: "#22e1ff" }}>positive</span><span>{h.positive.toLocaleString("en")}</span>
            <span style={{ color: "var(--ink-3)" }}>neutral</span><span>{h.neutral.toLocaleString("en")}</span>
            <span style={{ color: "#ff3d7f" }}>negative</span><span>{h.negative.toLocaleString("en")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
