import type { Pin, Week } from "@/lib/channel-visual";
import { SigChart, type Marker } from "../signal/SigChart";

const PIN = { breakout: "#ff3d7f", title: "#b4b4bb", shift: "#22e1ff" } as const;

/**
 * Weekly timeline: columns = views of the uploads published that week (left axis), line = comments that week
 * (right axis), markers above = breakouts (magenta, with the multiple), title changes (grey) and shifts (cyan).
 * Hover any week for the numbers and its events; drag the slider to zoom into a stretch of weeks.
 */
export function Timeline({ weeks, pins }: { weeks: Week[]; pins: Pin[] }) {
  const idx = new Map(weeks.map((w, i) => [w.week.slice(0, 10), i]));
  const markers: Marker[] = pins.flatMap((p) => {
    const i = idx.get(p.week.slice(0, 10));
    if (i === undefined) return [];
    return [{
      i, color: PIN[p.kind], href: p.id ? `/videos/${p.id}` : undefined, shape: p.kind === "shift" ? "diamond" as const : "dot" as const,
      tag: p.kind === "breakout" ? `${Math.round(p.score ?? 0)}×` : undefined,
      label: p.kind === "breakout" ? `Breakout: ${p.label} · ${(p.score ?? 0).toFixed(1)}× normal` : p.kind === "title" ? `Title change: ${p.label}` : p.label,
    }];
  });
  return (
    <div>
      <SigChart ariaLabel="Views and comments by week, with breakouts, title changes and shifts" x={weeks.map((w) => w.week.slice(0, 10))} unit="week"
        height={300} kind="bar" stacked={false} yLabel="Views" rightLabel="Comments" markers={markers} showTotal={false}
        series={[
          { key: "views", label: "Views of that week's uploads", color: "#22e1ff", values: weeks.map((w) => w.views) },
          { key: "uploads", label: "Uploads", color: "#55555e", values: weeks.map((w) => w.uploads), tipOnly: true },
          { key: "comments", label: "Comments that week", color: "#ededea", values: weeks.map((w) => w.comments), axis: "right" },
        ]} />
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10.5px] text-ink-3">
        <span><span style={{ color: PIN.breakout }}>●</span> breakout (3×+ normal, number = multiple)</span>
        <span><span style={{ color: PIN.title }}>●</span> title change</span>
        <span><span style={{ color: PIN.shift }}>◆</span> shift or spike</span>
        <span>hover a week for details · click a marker to open the video</span>
      </div>
    </div>
  );
}
