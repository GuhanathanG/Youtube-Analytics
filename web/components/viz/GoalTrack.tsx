import { goalTrack } from "@/lib/viz-math";

const fmt = (days: number) => new Date(Date.now() + days * 86400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });

/**
 * A goal on a line: today on the left, the date today's pace reaches it (cyan, or gold when that's after the
 * deadline) and the deadline (white flag). The gap between the two is how far ahead or behind you are.
 */
export function GoalTrack({ etaDays, deadline, reached }: { etaDays: number | null; deadline: string | null; reached: boolean }) {
  if (reached) return null;
  const dDays = deadline ? (new Date(`${deadline}T00:00:00Z`).getTime() - Date.now()) / 86400_000 : null;
  const t = goalTrack(etaDays, dDays);
  const late = t.eta !== null && t.deadline !== null && t.eta > t.deadline;
  const c = late ? "#fab219" : "#22d3ee";
  return (
    <div className="mt-4" role="img" aria-label={`${etaDays !== null ? `Reached around ${fmt(etaDays)} at today's pace` : "No date yet"}${deadline ? `, deadline ${fmt(dDays ?? 0)}` : ""}`}>
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-3 h-1 rounded-full bg-white/[0.06]" />
        {t.eta !== null && <div className="grow-x absolute left-0 top-3 h-1 origin-left rounded-full" style={{ width: `${t.eta * 100}%`, background: `linear-gradient(90deg, ${c}22, ${c})`, boxShadow: `0 0 10px -2px ${c}` }} />}
        {t.deadline !== null && t.eta !== null && (
          <div className="absolute top-2.5 h-2 rounded-full" style={{ left: `${Math.min(t.eta, t.deadline) * 100}%`, width: `${Math.abs(t.eta - t.deadline) * 100}%`,
            background: late ? "repeating-linear-gradient(90deg, #fab21955 0 4px, transparent 4px 8px)" : "repeating-linear-gradient(90deg, #0ca30c44 0 4px, transparent 4px 8px)" }} />
        )}
        <span className="absolute left-0 top-1.5 h-4 w-1 rounded bg-white/70" title="Today" />
        {t.eta !== null && <span className="viz-pop absolute top-1 h-5 w-5 -translate-x-1/2 rounded-full ring-2 ring-[#05070d]" style={{ left: `${t.eta * 100}%`, background: c, boxShadow: `0 0 12px ${c}` }} title={`At today's pace: ${fmt(etaDays ?? 0)}`} />}
        {t.deadline !== null && <span className="absolute -top-0.5 h-7 w-0.5 bg-white" style={{ left: `${t.deadline * 100}%` }} title="Deadline"><span className="absolute -top-0.5 left-0.5 h-2 w-2.5 rounded-r-sm bg-white" /></span>}
      </div>
      <div className="flex justify-between text-[11px] text-ink-3"><span>today</span><span className="tabular">{fmt(t.span)}</span></div>
    </div>
  );
}
