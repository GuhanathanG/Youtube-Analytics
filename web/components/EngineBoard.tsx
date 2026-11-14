import type { EngineCheck } from "@/lib/freshness-math";
import { overall } from "@/lib/freshness-math";

const TONE = {
  ok: { dot: "#0ca30c", text: "text-good", label: "fresh" },
  warn: { dot: "#fab219", text: "text-warn", label: "behind" },
  bad: { dot: "#e66767", text: "text-neg", label: "stuck" },
  idle: { dot: "#4a5163", text: "text-ink-3", label: "idle" },
} as const;

/** Every engine as a light: green = ran within its limit, amber = behind, red = stuck (also sent to Telegram). */
export function EngineBoard({ checks }: { checks: EngineCheck[] }) {
  const all = overall(checks);
  return (
    <div>
      <div className={`mb-3 text-[13px] ${TONE[all].text}`}>
        {all === "ok" ? "All engines fresh." : all === "warn" ? "Some engines are behind; they usually catch up on the next run." : "An engine is stuck. You'll get a Telegram alert too."}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {checks.map((c) => {
          const t = TONE[c.state];
          const fill = c.ageMin === null ? 0 : Math.min(1, c.ageMin / (c.limitMin * 2));
          return (
            <div key={c.key} className="rounded-xl border border-line bg-white/[0.02] p-3" data-engine={c.key} data-state={c.state}>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${c.state === "ok" ? "animate-[pulse-dot_2s_ease-out_infinite]" : ""}`} style={{ background: t.dot, boxShadow: `0 0 10px -1px ${t.dot}` }} />
                <span className="text-[13.5px] text-ink">{c.label}</span>
                <span className={`ml-auto text-[11.5px] ${t.text}`}>{t.label}</span>
              </div>
              <div className="mt-2 h-1 rounded-full bg-white/[0.06]">
                <div className="grow-x h-1 origin-left rounded-full" style={{ width: `${Math.max(3, fill * 100)}%`, background: t.dot, opacity: c.state === "idle" ? 0.3 : 0.8 }} />
              </div>
              <div className="mt-1.5 text-[11.5px] text-ink-3">{c.note}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
