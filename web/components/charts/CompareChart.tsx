"use client";

import { SigChart } from "../signal/SigChart";
import { fillGaps } from "../signal/Waveform";
// Fixed categorical order (never cycled): a channel keeps its colour whatever else is selected.
import { SERIES } from "./series";
export { SERIES };

/** Weekly mood score per channel (−100 all negative … +100 all positive), with a slider to pick the weeks. */
export function CompareChart({ data: raw, channels }: { data: Record<string, string | number | null>[]; channels: { id: string; title: string }[] }) {
  // Weeks with no analysed comments become gaps in the lines (not skipped), so the date axis stays even.
  type R = Record<string, string | number | null> & { day: string };
  const data = fillGaps<R>(raw.map((d) => ({ ...d, day: String(d.week).slice(0, 10) })), (day) => ({ day, week: day })).map((d): R => ({ ...d, week: d.day }));
  return (
    <SigChart ariaLabel="Weekly mood score per channel" x={data.map((d) => String(d.week))} unit="week" height={300} kind="line" kinds={["line", "bar"]}
      stacked={false} domain={[-100, 100]} yLabel="Mood score" yFormat={(v) => (v > 0 ? `+${v}` : String(v))} showTotal={false}
      series={channels.map((c, i) => ({ key: c.id, label: c.title, color: SERIES[i % SERIES.length], agg: "avg" as const,
        values: data.map((d) => (d[c.id] === null || d[c.id] === undefined ? null : Number(d[c.id]))) }))} />
  );
}
