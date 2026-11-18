"use client";
import { useEffect, useState } from "react";
import { useInView } from "./InView";

/** A hairline line chart that draws itself, with a glowing head dot at the latest value. */
export function MiniLine({ values, color = "#22e1ff", height = 44, delay = 300 }: { values: number[]; color?: string; height?: number; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  if (values.length < 2) return <div style={{ height }} />;
  const W = 200, H = 50, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 4 - ((v - min) / span) * (H - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [hx, hy] = pts[pts.length - 1];
  const t = `stroke-dashoffset 1.4s cubic-bezier(.3,.6,0,1) ${delay}ms`;
  return (
    <div ref={ref} style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden>
        <path d={d} fill="none" stroke={color} strokeWidth={4} opacity={0.25} style={{ filter: "blur(3px)", transition: t }} pathLength={1} strokeDasharray={1} strokeDashoffset={inView ? 0 : 1} vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke={color} strokeWidth={1.3} pathLength={1} strokeDasharray={1} strokeDashoffset={inView ? 0 : 1} style={{ transition: t }} vectorEffect="non-scaling-stroke" />
        <circle cx={hx} cy={hy} r={2.6} fill="#fff" opacity={inView ? 1 : 0} style={{ transition: `opacity .3s ${delay + 1300}ms` }} />
        <circle cx={hx} cy={hy} r={7} fill={color} opacity={inView ? 0.3 : 0} style={{ transition: `opacity .3s ${delay + 1300}ms` }} />
      </svg>
    </div>
  );
}

/** Section index on the right edge: highlights the section in view; click to jump. */
export function Rail({ items }: { items: { id: string; label: string }[] }) {
  const [on, setOn] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((es) => {
      const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (v) setOn(v.target.id);
    }, { rootMargin: "-35% 0px -55% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);
  return (
    <nav className="rail fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 lg:block" aria-label="Sections">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className={on === i.id ? "on" : ""}>
          <span className="mono" style={{ fontSize: 10, color: on === i.id ? "var(--ink)" : undefined }}>{i.label}</span><i />
        </a>
      ))}
    </nav>
  );
}
