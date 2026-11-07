/** Small server-rendered visuals for the Analytics page (no client JavaScript). */
import type { Cell } from "@/lib/analytics";

export const times = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "–" : `${x.toFixed(x >= 10 ? 0 : digits)}×`;

/** Outlier score badge: green above typical, red below. */
export function OutlierBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11.5px] text-ink-3 ring-1 ring-white/10">too new</span>;
  const tone = value >= 1.5 ? "bg-good/15 text-[#7fd67f] ring-good/30" : value < 0.67 ? "bg-neg/15 text-[#f3a9a9] ring-neg/30" : "bg-white/5 text-ink-2 ring-white/10";
  return <span className={`tabular rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ${tone}`} title="Views compared with this channel's typical video of the same format">{times(value)}</span>;
}

/** Day × time heatmap. Colour = median outlier score; numbers = how many videos. */
export function Heatmap({ days, blocks, cells }: { days: string[]; blocks: string[]; cells: Cell[][] }) {
  const color = (c: Cell) => {
    if (!c.count || c.outlier === null) return "rgba(255,255,255,0.03)";
    const t = Math.max(-1, Math.min(1, Math.log2(c.outlier))); // ½× … 2×
    return t >= 0 ? `rgba(34,211,238,${0.12 + 0.6 * t})` : `rgba(230,103,103,${0.12 + 0.5 * -t})`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] border-separate border-spacing-1 text-[11.5px]">
        <thead>
          <tr><th className="w-10" />{blocks.map((b) => <th key={b} className="font-normal text-ink-3">{b}</th>)}</tr>
        </thead>
        <tbody>
          {cells.map((row, d) => (
            <tr key={days[d]}>
              <th className="pr-1 text-left font-normal text-ink-3">{days[d]}</th>
              {row.map((c, b) => (
                <td key={b} className="h-9 rounded-md text-center tabular text-ink" style={{ background: color(c) }}
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

/** Tiny line chart of weekly counts. */
export function Sparkline({ values, color = "#22d3ee", width = 120, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-[11px] text-ink-3">–</span>;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - (v / max) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Two-part horizontal bar (e.g. new vs returning commenters). */
export function SplitBar({ a, b, aColor = "#22d3ee", bColor = "#8b7cf6", max }: { a: number; b: number; aColor?: string; bColor?: string; max: number }) {
  const w = (x: number) => `${max ? (x / max) * 100 : 0}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/5">
      <div style={{ width: w(a), background: aColor }} />
      <div style={{ width: w(b), background: bColor }} />
    </div>
  );
}

export function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[12px] text-ink-3">new</span>;
  const up = pct > 0;
  return <span className={`tabular text-[12px] font-medium ${Math.abs(pct) < 10 ? "text-ink-3" : up ? "text-accent" : "text-neg"}`}>
    {up ? "▲" : "▼"} {Math.abs(Math.round(pct))}%
  </span>;
}

export function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3.5">
      <div className="label">{label}</div>
      <div className="mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}
