"use client";
import { reducedMotion, useInView } from "./InView";
import { Decode } from "./Decode";
import { useEffect, useState } from "react";

/** Ring gauge made of ticks: they light up one by one to the value, with a sweeping needle and a decoded number. */
export function TickRing({ value, size = 168, label, sub, color = "#22e1ff" }: { value: number; size?: number; label: string; sub?: string; color?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const ticks = 60;
  const target = Math.round((Math.max(0, Math.min(100, value)) / 100) * ticks);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reducedMotion()) { setLit(target); return; }
    let i = 0;
    const id = setInterval(() => { i += 1; setLit(i); if (i >= target) clearInterval(id); }, 1100 / Math.max(1, target));
    return () => clearInterval(id);
  }, [inView, target]);
  const r = size / 2 - 8;
  const angle = (lit / ticks) * 360 - 90;
  return (
    <div ref={ref} className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
          const on = i < lit;
          const r1 = r - (i % 5 === 0 ? 10 : 6);
          return <line key={i} x1={size / 2 + Math.cos(a) * r1} y1={size / 2 + Math.sin(a) * r1} x2={size / 2 + Math.cos(a) * r} y2={size / 2 + Math.sin(a) * r}
            stroke={on ? color : "rgba(255,255,255,.14)"} strokeWidth={i % 5 === 0 ? 2 : 1.2} style={on ? { filter: `drop-shadow(0 0 3px ${color})` } : undefined} />;
        })}
        <circle cx={size / 2} cy={size / 2} r={r - 18} fill="none" stroke="rgba(255,255,255,.06)" />
        <line x1={size / 2} y1={size / 2} x2={size / 2 + Math.cos((angle * Math.PI) / 180) * (r - 20)} y2={size / 2 + Math.sin((angle * Math.PI) / 180) * (r - 20)}
          stroke={color} strokeWidth={1} opacity={lit ? 0.7 : 0} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="display" style={{ fontSize: size * 0.27, color }}><Decode value={value} /></div>
          <div className="mono" style={{ fontSize: 10 }}>{label}</div>
          {sub && <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink-2)" }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}
