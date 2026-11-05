"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, SENT } from "./colors";
import { GlassTooltip } from "./Tooltip";

/** Diverging bars: criticism to the left of zero, praise to the right. */
export function AspectChart({ data }: { data: { label: string; positive: number; negative: number }[] }) {
  const rows = data.slice(0, 9).map((d) => ({ label: d.label, praised: d.positive, criticised: -d.negative }));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SENT.negative }} />← criticised</span>
        <span className="flex items-center gap-1.5">praised →<span className="h-2.5 w-2.5 rounded-sm" style={{ background: SENT.positive }} /></span>
      </div>
      <ResponsiveContainer width="100%" height={44 + rows.length * 34}>
        <BarChart data={rows} layout="vertical" stackOffset="sign" margin={{ top: 0, right: 8, bottom: 0, left: 8 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => String(Math.abs(v))} />
          <YAxis type="category" dataKey="label" tick={{ fill: "#b4bccd", fontSize: 12 }} axisLine={false} tickLine={false} width={118} />
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<GlassTooltip />} />
          <Bar dataKey="criticised" name="Criticised" stackId="a" fill={SENT.negative} radius={[4, 0, 0, 4]} />
          <Bar dataKey="praised" name="Praised" stackId="a" fill={SENT.positive} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
