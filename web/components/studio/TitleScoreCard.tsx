import type { TitleScore } from "@/lib/packaging";

/** One scored title: neon bar, grade, what works and what to fix. */
export function TitleScoreCard({ t, rank }: { t: TitleScore; rank?: number }) {
  const color = t.score >= 80 ? "#c8a97e" : t.score >= 65 ? "#9c8467" : t.score >= 50 ? "#d3a657" : "#c98479";
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3.5">
      <div className="flex items-start gap-3">
        {rank !== undefined && <span className="font-serif-display text-[18px] leading-none text-accent/80">{String(rank).padStart(2, "0")}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium text-ink">{t.title}</div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full" style={{ width: `${t.score}%`, background: color, boxShadow: `0 0 10px ${color}` }} />
            </div>
            <span className="text-[13px] tabular" style={{ color }}>{t.score}</span>
            <span className="chip">{t.grade}</span>
          </div>
          {(t.good.length > 0 || t.fix.length > 0) && (
            <ul className="mt-2 space-y-0.5 text-[12px]">
              {t.good.map((g) => <li key={g} className="text-accent/90">✓ {g}</li>)}
              {t.fix.map((f) => <li key={f} className="text-ink-3">→ {f}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
