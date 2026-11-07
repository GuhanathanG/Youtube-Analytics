"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID } from "./colors";
import { GlassTooltip } from "./Tooltip";

const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"]; // fixed order, dark-mode steps

/** Monthly mentions per topic (aspect) — what viewers talk about, over the last 12 months. */
export function TopicChart({ months, series }: { months: string[]; series: { key: string; label: string; counts: number[] }[] }) {
  const data = months.map((m, i) => ({ month: m, ...Object.fromEntries(series.map((s) => [s.key, s.counts[i]])) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false}
          tickFormatter={(m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })} />
        <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<GlassTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, color: "#b4bccd" }} />
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={COLORS[i]} strokeWidth={2} dot={false}
            activeDot={{ r: 4, stroke: "#05070d", strokeWidth: 2 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
