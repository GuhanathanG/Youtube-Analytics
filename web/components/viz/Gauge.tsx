import type { CSSProperties } from "react";
import { gaugeAngle } from "@/lib/viz-math";
import { C, multColor } from "./tokens";

/**
 * "× usual" speedometer: 0.1× far left, 1× straight up, 10× far right (log scale). The needle swings
 * in from the left; the arc is red below usual, cyan → violet → gold above. Null = still measuring.
 */
export function Gauge({ index, size = 132 }: { index: number | null; size?: number }) {
  const r = 40, cx = 50, cy = 50;
  const angle = index == null ? -90 : gaugeAngle(index);
  const color = index == null ? "#4a5163" : multColor(index);
  const arc = (from: number, to: number) => {
    const p = (a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
    const [x1, y1] = p(from), [x2, y2] = p(to);
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };
  return (
    <svg viewBox="0 0 100 58" style={{ width: size, height: size * 0.58 }} className="shrink-0 overflow-visible" role="img"
      aria-label={index == null ? "Too early to tell" : `${index.toFixed(1)} times usual`}>
      <path d={arc(-90, 0)} fill="none" stroke={C.bad} strokeOpacity=".35" strokeWidth="7" strokeLinecap="round" />
      <path d={arc(0, 45)} fill="none" stroke={C.accent} strokeOpacity=".35" strokeWidth="7" />
      <path d={arc(45, 67.5)} fill="none" stroke={C.ai} strokeOpacity=".4" strokeWidth="7" />
      <path d={arc(67.5, 90)} fill="none" stroke={C.gold} strokeOpacity=".45" strokeWidth="7" strokeLinecap="round" />
      {[-90, 0, 90].map((a) => <line key={a} x1={cx + 33 * Math.sin((a * Math.PI) / 180)} y1={cy - 33 * Math.cos((a * Math.PI) / 180)}
        x2={cx + 29 * Math.sin((a * Math.PI) / 180)} y2={cy - 29 * Math.cos((a * Math.PI) / 180)} stroke="rgba(255,255,255,.35)" strokeWidth="1" />)}
      <g className="viz-needle" style={{ "--needle": `${angle}deg`, transformOrigin: `${cx}px ${cy}px` } as CSSProperties}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - 34} stroke={color} strokeWidth="2.6" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      </g>
      <circle cx={cx} cy={cy} r="4" fill={color} />
      <text x="6" y="57" fontSize="7" fill="#7c869b">0.1×</text>
      <text x="50" y="7" fontSize="7" fill="#7c869b" textAnchor="middle">1×</text>
      <text x="94" y="57" fontSize="7" fill="#7c869b" textAnchor="end">10×</text>
    </svg>
  );
}
