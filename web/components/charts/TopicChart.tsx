"use client";

import { SigChart } from "../signal/SigChart";

const COLORS = ["#22e1ff", "#ff3d7f", "#ededea", "#c98500", "#199e70", "#9085e9"]; // fixed order

/** Monthly mentions per topic (aspect): what viewers talk about, with a slider to pick the months. */
export function TopicChart({ months, series }: { months: string[]; series: { key: string; label: string; counts: number[] }[] }) {
  return (
    <SigChart ariaLabel="Mentions per month by topic" x={months} unit="month" height={280} kind="line" kinds={["line", "bar", "area"]} stacked={false}
      yLabel="Mentions" showTotal={false} series={series.map((s, i) => ({ key: s.key, label: s.label, color: COLORS[i % COLORS.length], values: s.counts }))} />
  );
}
