"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, SENT } from "./colors";
import { GlassTooltip } from "./Tooltip";

type Row = { day: string; positive: number; neutral: number; negative: number; pending: number };

/** Groups days into weeks or months when the range is long, so bars stay readable. */
function bucket(rows: Row[]): { rows: Row[]; unit: "day" | "week" | "month" } {
  if (rows.length < 2) return { rows, unit: "day" };
  const span = (Date.parse(rows[rows.length - 1].day) - Date.parse(rows[0].day)) / 86400000;
  const unit = span <= 60 ? "day" : span <= 730 ? "week" : "month";
  if (unit === "day") return { rows, unit };
  const map = new Map<string, Row>();
  for (const r of rows) {
    const d = new Date(r.day + "T00:00:00Z");
    if (unit === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    else d.setUTCDate(1);
    const key = d.toISOString().slice(0, 10);
    const cur = map.get(key) ?? { day: key, positive: 0, neutral: 0, negative: 0, pending: 0 };
    cur.positive += r.positive; cur.neutral += r.neutral; cur.negative += r.negative; cur.pending += r.pending;
    map.set(key, cur);
  }
  return { rows: [...map.values()], unit };
}

export function TrendChart({ data, height = 280 }: { data: Row[]; height?: number }) {
  const { rows, unit } = bucket(data);
  const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB",
    unit === "month" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" });
  const hasPending = rows.some((r) => r.pending > 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-2">
        {(["positive", "neutral", "negative"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SENT[k] }} />{k}</span>
        ))}
        {hasPending && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SENT.pending }} />not analysed yet</span>}
        <span className="ml-auto label">per {unit}</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="day" tickFormatter={fmt} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<GlassTooltip labelFormat={fmt} />} />
          <Bar dataKey="negative" name="Negative" stackId="s" fill={SENT.negative} />
          <Bar dataKey="neutral" name="Neutral" stackId="s" fill={SENT.neutral} />
          <Bar dataKey="positive" name="Positive" stackId="s" fill={SENT.positive} radius={[4, 4, 0, 0]} />
          {hasPending && <Bar dataKey="pending" name="Not analysed" stackId="s" fill={SENT.pending} radius={[4, 4, 0, 0]} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
