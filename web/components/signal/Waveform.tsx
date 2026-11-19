"use client";
import { SigChart } from "./SigChart";

export type Day = { day: string; positive: number; neutral: number; negative: number; pending?: number };

/** Fill missing days (or weeks) with zeros so the date axis is evenly spaced. */
export function fillGaps<T extends { day: string }>(rows: T[], blank: (day: string) => T): T[] {
  if (rows.length < 2) return rows;
  const step = Math.max(1, Math.round((Date.parse(rows[1].day) - Date.parse(rows[0].day)) / 86400000)) >= 6 ? 7 : 1;
  const by = new Map(rows.map((r) => [r.day.slice(0, 10), r]));
  const out: T[] = [];
  const end = Date.parse(rows[rows.length - 1].day.slice(0, 10));
  for (let t = Date.parse(rows[0].day.slice(0, 10)); t <= end; t += step * 86400000) {
    const k = new Date(t).toISOString().slice(0, 10);
    out.push(by.get(k) ?? blank(k));
  }
  return out;
}

/**
 * Conversation volume: comments per day (or week) as stacked columns, split by mood, with a labelled count axis,
 * dates underneath, totals for the chosen period in the legend, and a timeline slider.
 */
export function Waveform({ days, height = 300 }: { days: Day[]; height?: number }) {
  const rows = fillGaps(days, (day) => ({ day, positive: 0, neutral: 0, negative: 0, pending: 0 }));
  const pend = rows.some((r) => (r.pending ?? 0) > 0);
  return (
    <SigChart ariaLabel="Comments per day by mood" x={rows.map((r) => r.day)} height={height} yLabel="Comments" kinds={["bar", "area", "line"]}
      series={[
        { key: "positive", label: "Positive", color: "#22e1ff", values: rows.map((r) => r.positive) },
        { key: "neutral", label: "Neutral", color: "#6b6b75", values: rows.map((r) => r.neutral) },
        { key: "negative", label: "Negative", color: "#ff3d7f", values: rows.map((r) => r.negative) },
        ...(pend ? [{ key: "pending", label: "Not read yet", color: "#2f2f37", values: rows.map((r) => r.pending ?? 0) }] : []),
      ]} />
  );
}
