import { fillDays, type MoodDay } from "@/lib/viz-math";
import { SigChart } from "../signal/SigChart";
import { C } from "./tokens";

/**
 * Mood over time: comments per day as stacked columns coloured by mood, with a count axis, dates, legend totals for
 * the chosen period, a hover read-out (count and share of each mood) and a timeline slider. Switch to area or lines.
 */
export function MoodRiver({ rows, days = 90 }: { rows: MoodDay[]; days?: number }) {
  const filled = fillDays(rows, days);
  const sum = (k: keyof Omit<MoodDay, "day">) => filled.reduce((a, r) => a + r[k], 0);
  if (!filled.some((r) => r.positive + r.neutral + r.negative + r.pending)) {
    return <div className="grid h-[180px] place-items-center rounded-xl border border-dashed border-line-2 text-[13px] text-ink-3">No comments in this period yet.</div>;
  }
  const pend = sum("pending") > 0;
  return (
    <SigChart keyClass="mr-" x={filled.map((r) => r.day)} unit="day" height={300} yLabel="Comments / day" kinds={["bar", "area", "line"]}
      ariaLabel={`Comments per day over ${days} days by mood: ${sum("positive")} positive, ${sum("neutral")} neutral, ${sum("negative")} negative`}
      series={[
        { key: "positive", label: "Positive", color: C.pos, values: filled.map((r) => r.positive) },
        { key: "neutral", label: "Neutral", color: "#6b6b75", values: filled.map((r) => r.neutral) },
        { key: "negative", label: "Negative", color: C.neg, values: filled.map((r) => r.negative) },
        ...(pend ? [{ key: "pending", label: "Not read yet", color: "#2f2f37", values: filled.map((r) => r.pending) }] : []),
      ]} />
  );
}
