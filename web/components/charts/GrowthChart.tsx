"use client";

import { SigChart } from "../signal/SigChart";

/** A tracked total over time (subscribers, views): labelled axes, latest value and change for the chosen period, slider. */
export function GrowthChart({ data, dataKey, name, height = 240 }:
  { data: Record<string, string | number | null>[]; dataKey: string; name: string; height?: number }) {
  const xKey = Object.keys(data[0] ?? {}).find((k) => k === "day" || k === "at") ?? "day";
  // One point per day (the last reading of the day).
  const byDay = new Map<string, number | null>();
  for (const r of data) byDay.set(String(r[xKey]).slice(0, 10), r[dataKey] === null ? null : Number(r[dataKey]));
  const days = [...byDay.keys()];
  return (
    <SigChart ariaLabel={`${name} over time`} x={days} unit="day" height={height} kind="area" kinds={["area", "line", "bar"]} stacked={false} zero={false}
      yLabel={name} series={[{ key: dataKey, label: name, color: "#22e1ff", values: days.map((d) => byDay.get(d) ?? null), agg: "last" }]} />
  );
}
