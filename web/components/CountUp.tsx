"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export function CountUp({ value, format = "compact", prefix = "", suffix = "" }:
  { value: number; format?: "compact" | "full" | "signed"; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);

  useEffect(() => {
    if (!inView || reduce) { setShown(value); return; }
    const controls = animate(0, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    return () => controls.stop();
  }, [inView, value, reduce]);

  const text =
    format === "full" ? new Intl.NumberFormat("en").format(Math.round(shown))
    : format === "signed" ? `${shown > 0.5 ? "+" : ""}${Math.round(shown)}`
    : Math.abs(value) < 1000 ? String(Math.round(shown))
    : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(shown);
  return <span ref={ref} className="tabular">{prefix}{text}{suffix}</span>;
}
