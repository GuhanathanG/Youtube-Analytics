"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID } from "./colors";
import { GlassTooltip } from "./Tooltip";

// Fixed categorical order (never cycled): a channel keeps its colour whatever else is selected.
import { SERIES } from "./series";
export { SERIES };

export function CompareChart({ data, channels }: { data: Record<string, string | number | null>[]; channels: { id: string; title: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="week" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28}
          tickFormatter={(d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} />
        <YAxis domain={[-100, 100]} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
        <Tooltip content={<GlassTooltip valueFormat={(v) => String(v)} />} />
        <Legend wrapperStyle={{ fontSize: 12, color: "#b4bccd" }} />
        {channels.map((c, i) => (
          <Line key={c.id} type="monotone" dataKey={c.id} name={c.title} stroke={SERIES[i % SERIES.length]} strokeWidth={2}
            dot={false} activeDot={{ r: 4, stroke: "#05070d", strokeWidth: 2 }} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
