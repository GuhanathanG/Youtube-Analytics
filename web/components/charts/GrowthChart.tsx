"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ACCENT, AXIS, GRID } from "./colors";
import { GlassTooltip } from "./Tooltip";

export function GrowthChart({ data, dataKey, name, height = 200 }:
  { data: Record<string, string | number | null>[]; dataKey: string; name: string; height?: number }) {
  const xKey = Object.keys(data[0] ?? {}).find((k) => k === "day" || k === "at") ?? "day";
  const compact = (v: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const id = `g-${dataKey}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={xKey} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={32}
          tickFormatter={(d: string) => d.slice(5, 10)} />
        <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} domain={["auto", "auto"]} width={52} />
        <Tooltip content={<GlassTooltip valueFormat={(v) => new Intl.NumberFormat("en").format(v)} />} cursor={{ stroke: "rgba(255,255,255,0.2)" }} />
        <Area type="monotone" dataKey={dataKey} name={name} stroke={ACCENT} strokeWidth={2} fill={`url(#${id})`}
          dot={false} activeDot={{ r: 4, stroke: "#05070d", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
