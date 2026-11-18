"use client";
import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

/** True once the element has scrolled into view (stays true). Instruments start their animation then. */
export function useInView<T extends Element>(margin = "0px 0px -10% 0px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [inView, margin]);
  return [ref, inView] as const;
}

/** Adds the "in" class when visible: hairline cells draw, text rises, headline words slide up. */
export function InView({ as: Tag = "div", className = "", children, id }: { as?: ElementType; className?: string; children: ReactNode; id?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return <Tag ref={ref} id={id} className={`${className} ${inView ? "in" : ""}`}>{children}</Tag>;
}

/** Headline that slides in word by word. */
export function Words({ text, className = "", step = 70 }: { text: string; className?: string; step?: number }) {
  return (
    <span className={className}>
      {/* The sentence as plain text for screen readers and search; the animated words are decoration. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(" ").map((w, i) => (
          <span key={i} className="word"><span style={{ transitionDelay: `${i * step}ms` }}>{w}&nbsp;</span></span>
        ))}
      </span>
    </span>
  );
}

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
