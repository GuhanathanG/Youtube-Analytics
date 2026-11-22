"use client";

import { useEffect, useState } from "react";

type Job = { job: string; run_id: string | null; phase: string; step: number | null; total: number | null; loss: number | null; history: number[];
  note: string | null; started_at: string; updated_at: string; quiet_s: number; elapsed_s: number };

const NAMES: Record<string, string> = { reader: "Pulse Reader", engine: "Creator Model", channels: "Training channels", analyst: "Pulse Analyst (Kaggle)" };
const mins = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

function Curve({ points }: { points: number[] }) {
  if (points.length < 3) return null;
  const W = 220, H = 44, lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || 1;
  const d = points.map((v, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)},${(H - 3 - ((v - lo) / span) * (H - 6)).toFixed(1)}`).join(" ");
  return (
    <figure className="m-0">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Training loss from ${points[0]} to ${points[points.length - 1]}`}>
        <path d={d} fill="none" stroke="var(--cyan)" strokeWidth={1.5} />
      </svg>
      <figcaption className="mono" style={{ fontSize: 9.5 }}>loss {points[0].toFixed(2)} → {points[points.length - 1].toFixed(2)} (lower = learning)</figcaption>
    </figure>
  );
}

/** The Model Lab's live view: what each training job is doing right now, refreshed every few seconds. */
export function LiveTraining() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/lab/progress", { cache: "no-store" });
        if (r.ok && !stop) setJobs((await r.json()).jobs);
      } catch { /* offline: keep the last picture */ }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  if (!jobs) return <div className="mono mt-10" style={{ fontSize: 10.5 }}>Connecting to the live view…</div>;
  if (!jobs.length) return <div className="mono mt-10" style={{ fontSize: 10.5 }}>Live view: no training has reported yet. Start one below and it appears here.</div>;
  return (
    <section className="mt-10 border border-[var(--hair)]" aria-label="Live training" aria-live="polite">
      <div className="mono flex justify-between border-b border-[var(--hair)] px-5 py-3" style={{ fontSize: 10.5 }}>
        <span style={{ color: "var(--cyan)" }}>■ Live training</span><span>updates every 4 s</span>
      </div>
      <ul className="divide-y divide-[var(--hair)]">
        {jobs.map((j) => {
          const finished = j.phase === "done" || j.phase === "failed";
          const stalled = !finished && j.quiet_s > 600;
          const pct = j.total ? Math.min(100, Math.round(((j.step ?? 0) / j.total) * 100)) : null;
          const eta = !finished && pct && pct > 1 ? (j.elapsed_s / pct) * (100 - pct) : null;
          const color = j.phase === "failed" || stalled ? "var(--magenta)" : finished ? "var(--ink-3)" : "var(--cyan)";
          return (
            <li key={j.job} className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-[15px]">{NAMES[j.job] ?? j.job}</span>
                  <span className="mono" style={{ fontSize: 10, color }}>
                    {stalled ? `no update for ${mins(j.quiet_s)}` : finished ? `${j.phase} ${mins(j.quiet_s)} ago` : "running"}
                  </span>
                </div>
                <div className="mt-1 text-[13px] text-ink-2">{j.phase === "done" || j.phase === "failed" ? j.note ?? "" : j.phase}{!finished && j.note ? ` · ${j.note}` : ""}</div>
                {!finished && (
                  <div className="mt-3">
                    <div className="h-1.5 bg-white/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label={`${NAMES[j.job] ?? j.job} progress`}>
                      <div className="h-1.5 transition-all duration-700" style={{ width: `${pct ?? 8}%`, background: "var(--cyan)", boxShadow: "0 0 10px rgba(34,225,255,.5)" }} />
                    </div>
                    <div className="mono mt-1.5 flex flex-wrap gap-x-4" style={{ fontSize: 10 }}>
                      {j.total ? <span>step {(j.step ?? 0).toLocaleString("en")} of {j.total.toLocaleString("en")} ({pct}%)</span> : null}
                      <span>running {mins(j.elapsed_s)}</span>{eta ? <span>about {mins(eta)} left</span> : null}
                      {j.loss !== null ? <span>loss {j.loss.toFixed(3)}</span> : null}
                    </div>
                  </div>
                )}
              </div>
              <Curve points={j.history ?? []} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
