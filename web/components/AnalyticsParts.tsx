/** Small server-rendered visuals for the Analytics page (no client JavaScript). */
import type { Cell } from "@/lib/analytics";

export const times = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "–" : `${x.toFixed(x >= 10 ? 0 : digits)}×`;

/** Outlier score badge: green above typical, red below. */
export function OutlierBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="rounded-sm px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3 ring-1 ring-white/10">too new</span>;
  const tone = value >= 2 ? "bg-neg/10 text-neg ring-neg/40 shadow-[0_0_10px_rgba(255,61,127,.25)]" : value >= 1.2 ? "bg-accent/10 text-accent ring-accent/35"
    : value < 0.67 ? "text-ink-3 ring-white/10" : "text-ink-2 ring-white/15";
  return <span className={`tabular rounded-sm px-2 py-0.5 font-mono text-[11px] ring-1 ${tone}`} title="Views compared with this channel's typical video of the same format">{times(value)}</span>;
}

/** Day × time heatmap. Colour = median outlier score; numbers = how many videos. */
export function Heatmap({ days, blocks, cells }: { days: string[]; blocks: string[]; cells: Cell[][] }) {
  const color = (c: Cell) => {
    if (!c.count || c.outlier === null) return "rgba(255,255,255,0.025)";
    const t = Math.max(-1, Math.min(1, Math.log2(c.outlier))); // ½× … 2×
    return t >= 0 ? `rgba(34,225,255,${0.1 + 0.65 * t})` : `rgba(255,61,127,${0.1 + 0.5 * -t})`;
  };
  const glow = (c: Cell) => (c.count >= 3 && c.outlier !== null && c.outlier >= 1.4 ? "0 0 14px rgba(34,225,255,.45)" : undefined);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] border-separate border-spacing-[5px] font-mono text-[11px]">
        <thead>
          <tr><th className="w-10" />{blocks.map((b) => <th key={b} className="pb-1 font-normal text-ink-3">{b}</th>)}</tr>
        </thead>
        <tbody>
          {cells.map((row, d) => (
            <tr key={days[d]}>
              <th className="pr-1 text-left font-normal uppercase tracking-[0.1em] text-ink-3">{days[d]}</th>
              {row.map((c, b) => (
                <td key={b} className="led h-10 text-center tabular text-ink" style={{ background: color(c), boxShadow: glow(c), animationDelay: `${d * 70 + b * 25}ms` }}
                  title={c.count ? `${days[d]} ${blocks[b]}: ${c.count} videos, typical ${times(c.outlier)}` : "No uploads"}>
                  {c.count ? <span className={c.count < 3 ? "text-ink-3" : ""}>{times(c.outlier)}</span> : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Small weekly column chart with its numbers printed: each column is one week (hover for the value), and the
 * first and latest weeks are labelled underneath so the trend reads without guessing.
 */
export function Sparkline({ values, color = "#22e1ff", width = 132, height = 30, unit = "", fmt = (v: number) => compactN(v) }:
  { values: number[]; color?: string; width?: number; height?: number; unit?: string; fmt?: (v: number) => string }) {
  if (values.length < 2) return <span className="text-[11px] text-ink-3">–</span>;
  const max = Math.max(...values, 1), n = values.length, slot = width / n, bw = Math.max(2, slot * 0.66);
  const wk = (i: number) => (n - 1 - i === 0 ? "this week" : `${n - 1 - i} wk ago`);
  return (
    <span className="inline-flex flex-col">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Weekly values, oldest to latest: ${values.map(fmt).join(", ")}`}>
        <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="rgba(255,255,255,.18)" />
        {values.map((v, i) => {
          const h = Math.max(1, (v / max) * (height - 3));
          return <rect key={i} x={i * slot + (slot - bw) / 2} y={height - h} width={bw} height={h} fill={color} opacity={i === n - 1 ? 1 : 0.55}><title>{`${wk(i)}: ${fmt(v)}${unit}`}</title></rect>;
        })}
      </svg>
      <span className="mt-1 flex justify-between font-mono text-[9.5px] text-ink-3" style={{ width }}>
        <span>{n} wk ago {fmt(values[0])}</span><span className="text-ink">now {fmt(values[n - 1])}</span>
      </span>
    </span>
  );
}
const compactN = (v: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(v * 10) / 10);

/** Two-part horizontal bar (e.g. new vs returning commenters). */
export function SplitBar({ a, b, aColor = "#22e1ff", bColor = "#55555e", max }: { a: number; b: number; aColor?: string; bColor?: string; max: number }) {
  const w = (x: number) => `${max ? (x / max) * 100 : 0}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden bg-white/5">
      <div style={{ width: w(a), background: aColor }} />
      <div style={{ width: w(b), background: bColor }} />
    </div>
  );
}

export function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[12px] text-ink-3">new</span>;
  const up = pct > 0;
  return <span className={`tabular font-mono text-[11.5px] ${Math.abs(pct) < 10 ? "text-ink-3" : up ? "text-accent" : "text-neg"}`}>
    {up ? "▲" : "▼"} {Math.abs(Math.round(pct))}%
  </span>;
}

export function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-line bg-white/[0.015] p-4">
      <div className="label">{label}</div>
      <div className="mt-2 font-[family-name:var(--font-display)] text-[22px] font-extrabold tabular text-ink">{value}</div>
      {hint && <div className="mt-1 text-[12.5px] text-ink-3">{hint}</div>}
    </div>
  );
}
