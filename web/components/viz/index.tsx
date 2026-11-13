/**
 * Creator Pulse visual library ("viz"): the shapes every number wears. Server components (SVG + CSS), so they add
 * no JavaScript to a page; motion is pure CSS and switches off for people who prefer reduced motion.
 * See docs/UI_UX_REVAMP.md §5 for when to use which.
 */
import type { CSSProperties, ReactNode } from "react";
import { CountUp } from "../CountUp";

export const C = {
  accent: "#22d3ee", ai: "#8b7cf6", gold: "#fab219", good: "#0ca30c", bad: "#e66767",
  pos: "#3987e5", neu: "#8a8f9c", neg: "#e66767", yt: "#ff3b4a", ig: "#e1306c", ig2: "#f77737",
};

/* ------------------------------------------------------------------ Sparkline */
/** A small line that draws itself left → right, with a soft area under it and a glowing dot on the latest value. */
export function Sparkline({ data, color = C.accent, height = 36, className = "" }: { data: number[]; color?: string; height?: number; className?: string }) {
  const pts = data.filter((x) => Number.isFinite(x));
  if (pts.length < 2) return <div style={{ height }} className={className} />;
  const w = 100, min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const id = `sg${Math.round((pts[0] + pts.length * 7 + max) * 1000) % 1e6}`;
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={`block w-full overflow-visible ${className}`} style={{ height }} aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} className="viz-fade" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" pathLength={1} className="viz-draw" />
      <circle cx={lx} cy={ly} r="2.2" fill={color} className="viz-dot" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}

/* ------------------------------------------------------------------ Delta */
export function Delta({ value, suffix = "%", invert = false }: { value: number | null; suffix?: string; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0, good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11.5px] tabular ring-1 ${good ? "bg-good/10 text-good ring-good/30" : "bg-neg/10 text-neg ring-neg/30"}`}>
      {up ? "▲" : "▼"} {Math.abs(Math.round(value))}{suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ KpiOrb */
/** A number with a shape: count-up value, change vs the previous period, a sparkline, and a "vs normal" chip. */
export function KpiOrb({ label, value, format = "compact", suffix = "", delta = null, deltaSuffix = "%", trend = [], color = C.accent, hint, focal = false, chip }:
  { label: string; value: number; format?: "compact" | "full" | "signed"; suffix?: string; delta?: number | null; deltaSuffix?: string; trend?: number[];
    color?: string; hint?: ReactNode; focal?: boolean; chip?: ReactNode }) {
  return (
    <div className={`panel relative flex h-full flex-col overflow-hidden p-5 ${focal ? "holo" : ""}`}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-20 blur-2xl" style={{ background: color }} />
      <div className="flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        {chip}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className={`font-[family-name:var(--font-display)] text-[34px] font-semibold leading-none tracking-tight ${focal ? "glow-text" : "text-ink"}`}>
          <CountUp value={value} format={format} suffix={suffix} />
        </span>
        <span className="pb-0.5"><Delta value={delta} suffix={deltaSuffix} /></span>
      </div>
      {hint && <div className="mt-1.5 text-[12px] text-ink-3">{hint}</div>}
      <div className="mt-auto pt-3">{trend.length >= 2 ? <Sparkline data={trend} color={color} /> : <div className="h-9" />}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ MultChip */
/** "3.2× normal": one look everywhere. Cyan under 5×, violet 5-10×, gold 10×+, red when below normal. */
export function multColor(x: number) { return x >= 10 ? C.gold : x >= 5 ? C.ai : x >= 1 ? C.accent : C.bad; }
export function MultChip({ value, suffix = "normal", size = "sm" }: { value: number; suffix?: string; size?: "sm" | "lg" }) {
  const c = multColor(value);
  const text = value >= 10 ? `${Math.round(value)}×` : `${value.toFixed(1)}×`;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-[family-name:var(--font-display)] tabular ring-1 ${size === "lg" ? "px-3 py-1 text-[15px]" : "px-2 py-0.5 text-[12px]"}`}
      style={{ color: c, background: `${c}1a`, boxShadow: value >= 5 ? `0 0 14px -3px ${c}` : undefined, ["--tw-ring-color" as string]: `${c}55` }}>
      {text}{suffix && <span className="font-sans text-[0.8em] opacity-70">{suffix}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ PulseRing */
/** A 0-100 score: the arc sweeps to the value; a slow ripple shows it's live. Optional inner sparkline. */
export function PulseRing({ value, label, sub, color = C.accent, size = 168, trend }: { value: number; label: string; sub?: ReactNode; color?: string; size?: number; trend?: number[] }) {
  const r = 44, circ = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <span className="viz-ripple absolute inset-3 rounded-full" style={{ boxShadow: `0 0 0 0 ${color}66` }} />
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="6" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" className="viz-arc"
          style={{ strokeDasharray: circ, "--arc-to": circ * (1 - v / 100), "--arc-from": circ, filter: `drop-shadow(0 0 6px ${color})` } as CSSProperties} />
      </svg>
      <div className="relative flex flex-col items-center text-center">
        <span className="font-[family-name:var(--font-display)] font-semibold leading-none tabular" style={{ color, fontSize: size * 0.24 }}><CountUp value={v} /></span>
        <span className="label mt-1">{label}</span>
        {sub && <span className="mt-0.5 text-[11px] text-ink-3">{sub}</span>}
        {trend && trend.length >= 2 && <div className="mt-1.5" style={{ width: size * 0.45 }}><Sparkline data={trend} color={color} height={16} /></div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ MoodGlyph */
/** The one sentiment shape: blue/grey/red donut with a face for the overall mood. */
export function MoodGlyph({ positive, neutral, negative, size = 96 }: { positive: number; neutral: number; negative: number; size?: number }) {
  const total = positive + neutral + negative;
  if (!total) return <div className="grid place-items-center rounded-full border border-dashed border-line-2 text-[11px] text-ink-3" style={{ width: size, height: size }}>no data</div>;
  const a = (positive / total) * 100, b = a + (neutral / total) * 100;
  const net = (positive - negative) / total;
  const face = net > 0.4 ? "😍" : net > 0.15 ? "🙂" : net > -0.15 ? "😐" : net > -0.4 ? "🙁" : "😠";
  return (
    <div className="viz-pop relative shrink-0 rounded-full" role="img" aria-label={`${Math.round(a)}% positive, ${Math.round((negative / total) * 100)}% negative`}
      style={{ width: size, height: size, background: `conic-gradient(${C.pos} 0 ${a}%, ${C.neu} ${a}% ${b}%, ${C.neg} ${b}% 100%)`, boxShadow: `0 0 26px -8px ${net >= 0 ? C.pos : C.neg}` }}>
      <div className="absolute grid place-items-center rounded-full bg-[#05070d]" style={{ inset: size * 0.12 }}>
        <span style={{ fontSize: size * 0.32 }}>{face}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ HeroStage */
/** The focal card at the top of a page: lit gradient, glass, slow aurora behind it (the only looping ambience). */
export function HeroStage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`panel holo hero-stage relative overflow-hidden p-6 sm:p-8 ${className}`}>
      <div className="viz-aurora pointer-events-none absolute -inset-1/4 opacity-40" aria-hidden />
      <div className="relative">{children}</div>
    </section>
  );
}

export { SectionNav } from "./SectionNav";
export { Drawer } from "./Drawer";
