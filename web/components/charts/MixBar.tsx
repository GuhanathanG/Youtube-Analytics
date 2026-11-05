import { SENT } from "./colors";

/** One 100% bar showing the positive / neutral / negative split, with direct labels. */
export function MixBar({ mix, size = "md" }: { mix: { positive: number; neutral: number; negative: number; pending?: number }; size?: "sm" | "md" }) {
  const parts = [
    { key: "negative", n: mix.negative, color: SENT.negative },
    { key: "neutral", n: mix.neutral, color: SENT.neutral },
    { key: "positive", n: mix.positive, color: SENT.positive },
  ];
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (!total) return <div className={`${size === "sm" ? "h-1.5" : "h-3"} rounded-full bg-white/5`} />;
  return (
    <div>
      <div className={`flex ${size === "sm" ? "h-1.5 gap-[2px]" : "h-3 gap-[2px]"} overflow-hidden rounded-full`} role="img"
        aria-label={parts.map((p) => `${p.key} ${Math.round((p.n / total) * 100)}%`).join(", ")}>
        {parts.filter((p) => p.n > 0).map((p) => (
          <div key={p.key} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} title={`${p.key}: ${p.n.toLocaleString("en")}`} />
        ))}
      </div>
      {size === "md" && (
        <div className="mt-2 flex justify-between text-[12px] text-ink-2 tabular">
          {parts.map((p) => (
            <span key={p.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
              {p.key} <span className="text-ink">{Math.round((p.n / total) * 100)}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
