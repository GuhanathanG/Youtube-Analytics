import Link from "next/link";
import type { Pin, Week } from "@/lib/channel-visual";
import { compact } from "@/lib/format";

/**
 * Weekly timeline: bars = views of uploads published that week (grow up in order), line = comments that week
 * (draws itself), pins = events (gold = breakout, violet = title change) dropping in above their week.
 * Server-rendered SVG + CSS; hover a bar or pin for details.
 */
export function Timeline({ weeks, pins }: { weeks: Week[]; pins: Pin[] }) {
  const W = 1000, H = 260, top = 46, base = H - 26;
  const n = weeks.length, slot = W / n, bw = slot * 0.62;
  const maxV = Math.max(1, ...weeks.map((w) => w.views)), maxC = Math.max(1, ...weeks.map((w) => w.comments));
  const x = (i: number) => i * slot + slot / 2;
  const yV = (v: number) => base - (v / maxV) * (base - top);
  const yC = (c: number) => base - (c / maxC) * (base - top);
  const line = weeks.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yC(w.comments).toFixed(1)}`).join(" ");
  const idx = new Map(weeks.map((w, i) => [w.week, i]));
  const byWeek = new Map<number, Pin[]>();
  for (const p of pins) { const i = idx.get(p.week); if (i !== undefined) byWeek.set(i, [...(byWeek.get(i) ?? []), p]); }
  const label = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "linear-gradient(#22d3ee,#8b7cf6)" }} />views of that week&apos;s uploads</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: "#3987e5" }} />comments that week</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#fab219" }} />breakout (3×+)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#8b7cf6" }} />title change</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[260px] w-full overflow-visible" role="img" aria-label="Views and comments by week, with breakouts and title changes">
        <defs>
          <linearGradient id="tl-bar" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#8b7cf6" stopOpacity=".25" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="0" x2={W} y1={base - f * (base - top)} y2={base - f * (base - top)} stroke="rgba(255,255,255,.05)" />)}
        {weeks.map((w, i) => (
          <g key={w.week}>
            <rect x={x(i) - bw / 2} y={yV(w.views)} width={bw} height={Math.max(0, base - yV(w.views))} rx="3" fill="url(#tl-bar)" className="grow-y"
              style={{ transformBox: "fill-box", animationDelay: `${i * 25}ms`, opacity: w.uploads ? 0.9 : 0.25 }}>
              <title>{`Week of ${label(w.week)}: ${w.uploads} upload${w.uploads === 1 ? "" : "s"}, ${compact(w.views)} views, ${compact(w.comments)} comments`}</title>
            </rect>
            {i % 4 === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#7c869b">{label(w.week)}</text>}
          </g>
        ))}
        <path d={line} fill="none" stroke="#3987e5" strokeWidth="2.5" pathLength={1} className="viz-draw" style={{ filter: "drop-shadow(0 0 4px #3987e5)" }} />
        {[...byWeek.entries()].map(([i, ps]) => ps.slice(0, 3).map((p, k) => {
          const c = p.kind === "breakout" ? "#fab219" : "#8b7cf6";
          const cy = top - 22 - k * 16;
          return (
            <Link key={`${p.id}-${p.kind}-${k}`} href={`/videos/${p.id}`}>
              <g className="pin-drop" style={{ animationDelay: `${600 + i * 30}ms` }}>
                <line x1={x(i)} x2={x(i)} y1={cy} y2={yV(weeks[i].views)} stroke={c} strokeOpacity=".35" strokeDasharray="2 3" />
                <circle cx={x(i)} cy={cy} r="7" fill={c} style={{ filter: `drop-shadow(0 0 6px ${c})` }} />
                {p.kind === "breakout" && <text x={x(i)} y={cy + 3.5} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#05070d">{Math.round(p.score ?? 0)}×</text>}
                <title>{p.kind === "breakout" ? `${p.label} · ${(p.score ?? 0).toFixed(1)}× normal` : p.label}</title>
              </g>
            </Link>
          );
        }))}
      </svg>
    </div>
  );
}
