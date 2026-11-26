"use client";
import { SigChart } from "@/components/signal/SigChart";
import type { ModelRun } from "@/lib/lab";

const NAMES: Record<string, string> = {
  "pulse-reader": "Pulse Reader · mood macro-F1 on held-out comments",
  "pulse-analyst": "Pulse Analyst · summary overlap with the cloud AI",
  "creator-youtube": "Creator Model (YouTube) · forecasts within 2× of real views",
  "creator-instagram": "Creator Model (Instagram) · forecasts within 2× of real views",
  tanglish: "Tanglish mood head · mood macro-F1",
};
const BASELINE: Record<string, string> = {
  "pulse-reader": "model in use at the time", tanglish: "current mood model",
  "creator-youtube": "simple guess (channel's usual views)", "creator-instagram": "simple guess (channel's usual views)",
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** One small chart per model: each training run's held-out score (and what it was compared against). Runs that
 * were not adopted are marked; the model in use only changes when a run is at least as good. */
export function ScoreHistory({ runs }: { runs: ModelRun[] }) {
  const byModel = new Map<string, ModelRun[]>();
  for (const r of runs) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  if (!byModel.size) return <p className="mt-4 text-[13.5px] text-ink-3">No training runs recorded yet: each run adds a point here.</p>;
  return (
    <div className="mt-6 grid gap-px bg-[var(--hair)] lg:grid-cols-2">
      {[...byModel.entries()].map(([model, rs]) => {
        const first = rs[0], last = rs[rs.length - 1];
        const change = rs.length > 1 && first.score != null && last.score != null ? last.score - first.score : null;
        const hasBase = rs.some((r) => r.baseline != null);
        return (
          <div key={model} className="bg-[var(--bg)] p-5 md:p-6" data-model-history={model}>
            <div className="mono" style={{ fontSize: 10.5 }}>{NAMES[model] ?? model}</div>
            <p className="mt-2 text-[13.5px] text-ink-2">
              {rs.length} run{rs.length === 1 ? "" : "s"} · latest {last.score != null ? pct(last.score) : "—"}
              {change != null ? <> · {change >= 0 ? "+" : ""}{Math.round(change * 1000) / 10} pts since the first</> : null}
            </p>
            {rs.length >= 2 ? (
              <div className="mt-3">
                <SigChart x={rs.map((r) => r.runAt.slice(0, 10))} kind="line" kinds={["line"]} stacked={false} brush={false} height={170}
                  zero={false} yFormat={pct} ariaLabel={`Score history for ${NAMES[model] ?? model}`} keyClass="sh-"
                  series={[{ key: "score", label: "Held-out score", color: "var(--cyan)", values: rs.map((r) => r.score), agg: "last" },
                    ...(hasBase ? [{ key: "base", label: `Compared with: ${BASELINE[model] ?? "previous"}`, color: "var(--ink-3)",
                      values: rs.map((r) => r.baseline), agg: "last" as const }] : [])]}
                  markers={rs.flatMap((r, i) => r.adopted ? [] : [{ i, label: `Not adopted: ${r.note ?? "not better"}`, color: "var(--magenta)", shape: "diamond" as const }])} />
              </div>
            ) : <p className="mt-3 text-[12.5px] text-ink-3">The chart appears after the second run.</p>}
            <ul className="mt-3 space-y-1 text-[12.5px] text-ink-3">
              {rs.slice(-3).reverse().map((r) => (
                <li key={r.runAt}>{r.runAt.slice(0, 16).replace("T", " ")} · {r.score != null ? pct(r.score) : "—"} · {r.adopted ? "in use" : "kept the previous model"}{r.note ? ` · ${r.note}` : ""}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
