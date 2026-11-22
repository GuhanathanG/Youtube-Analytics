/**
 * Creator Pulse visual library ("viz"): the shapes every number wears. Server components (SVG + CSS), so they add
 * no JavaScript to a page; motion is pure CSS and switches off for people who prefer reduced motion.
 * See docs/UI_UX_REVAMP.md §5 for when to use which.
 */
import { C, multColor } from "./tokens";
export { C, multColor };

/* ------------------------------------------------------------------ MultChip */
/** "3.2× normal": one look everywhere. Cyan under 5×, violet 5-10×, gold 10×+, red when below normal. */
export function MultChip({ value, suffix = "normal", size = "sm" }: { value: number; suffix?: string; size?: "sm" | "lg" }) {
  const c = multColor(value);
  const text = value >= 10 ? `${Math.round(value)}×` : `${value.toFixed(1)}×`;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-[family-name:var(--font-display)] tabular ring-1 ${size === "lg" ? "px-3 py-1 text-[15px]" : "px-2 py-0.5 text-[12px]"}`}
      style={{ color: c, background: `${c}1a`, boxShadow: value >= 5 ? `0 0 14px -3px ${c}` : undefined, ["--tw-ring-color" as string]: `${c}55` }}>
      {text}{suffix && <span className="font-sans text-[0.8em] opacity-70">{suffix}</span>}
    </span>
  );
}

export { SectionNav } from "./SectionNav";
export { MoodRiver } from "./MoodRiver";
export { Gauge } from "./Gauge";
export { RangeBar } from "./RangeBar";
export { GoalTrack } from "./GoalTrack";
