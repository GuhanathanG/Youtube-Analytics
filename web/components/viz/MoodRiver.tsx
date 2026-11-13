import { bandPath, fillDays, riverLayers, smooth, MOOD_KEYS, type MoodDay } from "@/lib/viz-math";
import { C } from "./tokens";

const COLORS = { positive: C.pos, neutral: C.neu, negative: C.neg, pending: "#3a4152" } as const;
const NAMES = { positive: "positive", neutral: "neutral", negative: "negative", pending: "not read yet" } as const;

/**
 * Mood river: a streamgraph of comments per day, its width the volume, its colours the mood.
 * Bands flow in left → right (CSS clip), server-rendered SVG, no JavaScript.
 */
export function MoodRiver({ rows, days = 90 }: { rows: MoodDay[]; days?: number }) {
  const W = 1000, H = 220;
  const filled = fillDays(rows, days);
  const total = filled.reduce((a, r) => a + r.positive + r.neutral + r.negative + r.pending, 0);
  if (!total) return <div className="grid h-[180px] place-items-center rounded-xl border border-dashed border-line-2 text-[13px] text-ink-3">No comments in this period yet.</div>;
  const layers = riverLayers(smooth(filled, 5), W, H);
  const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const sum = (k: (typeof MOOD_KEYS)[number]) => filled.reduce((a, r) => a + r[k], 0);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
        {MOOD_KEYS.map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[k] }} />
            {NAMES[k]} <span className="tabular text-ink-2">{sum(k).toLocaleString("en")}</span></span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="block h-[240px] w-full" role="img"
        aria-label={`Comments per day over ${days} days by mood: ${sum("positive")} positive, ${sum("neutral")} neutral, ${sum("negative")} negative`}>
        <defs>
          {MOOD_KEYS.map((k) => (
            <linearGradient key={k} id={`mr-${k}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={COLORS[k]} stopOpacity=".55" /><stop offset="100%" stopColor={COLORS[k]} stopOpacity=".95" />
            </linearGradient>
          ))}
        </defs>
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,.05)" />
        <g className="viz-flow-in">
          {MOOD_KEYS.map((k) => <path key={k} d={bandPath(layers[k])} fill={`url(#mr-${k})`} stroke={COLORS[k]} strokeOpacity=".5" strokeWidth=".6" />)}
        </g>
        {filled.map((r, i) => i % 15 === 0 || i === filled.length - 1
          ? <text key={r.day} x={(i / (filled.length - 1)) * W} y={H + 16} textAnchor={i === 0 ? "start" : i === filled.length - 1 ? "end" : "middle"} fontSize="11" fill="#7c869b">{label(r.day)}</text>
          : null)}
      </svg>
    </div>
  );
}
