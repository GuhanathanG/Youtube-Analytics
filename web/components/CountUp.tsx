"use client";

import { useEffect, useRef, useState } from "react";

/** A number that counts up once it scrolls into view (no animation library; respects reduced motion). */
export function CountUp({ value, format = "compact", prefix = "", suffix = "" }:
  { value: number; format?: "compact" | "full" | "signed"; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let raf = 0;
    const run = () => {
      const start = performance.now(), dur = 1100;
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / dur);
        setShown(value * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); run(); } });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);

  const text =
    format === "full" ? new Intl.NumberFormat("en").format(Math.round(shown))
    : format === "signed" ? `${shown > 0.5 ? "+" : ""}${Math.round(shown)}`
    : Math.abs(value) < 1000 ? String(Math.round(shown))
    : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(shown);
  return <span ref={ref} className="tabular">{prefix}{text}{suffix}</span>;
}
