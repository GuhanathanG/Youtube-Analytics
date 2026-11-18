"use client";
import { useEffect, useState } from "react";
import { reducedMotion, useInView } from "./InView";

const GLYPHS = "0123456789#%&@$";

/**
 * A number that "decodes": random glyphs flicker first, then it counts up to the real value.
 * format: "int" 975,912 · "compact" 975.9K · "signed" +37 · "pct" 14%
 */
export function Decode({ value, format = "int", delay = 0, className = "", duration = 1100 }: {
  value: number; format?: "int" | "compact" | "signed" | "pct"; delay?: number; className?: string; duration?: number;
}) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const final = fmt(value, format);
  const [shown, setShown] = useState(final);
  useEffect(() => {
    if (!inView || reducedMotion()) { setShown(final); return; }
    let raf = 0;
    const start = performance.now() + delay;
    const scramble = 380;
    const tick = (now: number) => {
      const t = now - start;
      if (t < 0) { setShown(final.replace(/[0-9]/g, "0")); raf = requestAnimationFrame(tick); return; }
      if (t < scramble) {
        setShown(final.replace(/[0-9]/g, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]));
      } else {
        const p = Math.min(1, (t - scramble) / duration);
        const e = 1 - Math.pow(1 - p, 4);
        setShown(fmt(value * e, format));
        if (p >= 1) { setShown(final); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, format, delay, duration, final]);
  return <span ref={ref} className={`tab ${className}`}>{shown}</span>;
}

export function fmt(v: number, f: "int" | "compact" | "signed" | "pct"): string {
  if (f === "compact") {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
    return Math.round(v).toString();
  }
  if (f === "signed") return (v >= 0 ? "+" : "−") + Math.abs(Math.round(v));
  if (f === "pct") return Math.round(v) + "%";
  return Math.round(v).toLocaleString("en");
}
