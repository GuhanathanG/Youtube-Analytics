import { Brain } from "lucide-react";
import type { CreatorProfile, MonthMemory } from "@/lib/memory";
import { ago, compact, score } from "@/lib/format";
import { Empty, Panel } from "./ui";

const List = ({ title, items }: { title: string; items?: string[] }) => !items?.length ? null : (
  <div><div className="label mb-1.5">{title}</div><ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
);

/** Creator Memory: the AI's long-term understanding of this creator, built month by month. */
export function MemoryPanel({ profile, months }: { profile: CreatorProfile | null; months: MonthMemory[] }) {
  return (
    <Panel title={<span className="flex items-center gap-2"><Brain size={16} className="text-accent-2" />Creator memory</span>}
      subtitle={profile ? `What the AI knows from ${profile.months ?? months.length} months of comments · updated ${ago(profile.created_at)}` : "The AI's long-term picture of this creator, built month by month"}>
      {!profile && !months.length ? <Empty>The AI writes one memory per month of comments (about 6 an hour, newest first), then a profile from all of them.</Empty> : (
        <div className="space-y-5">
          {profile && (
            <div className="space-y-4">
              {profile.one_line && <p className="text-[15px] font-medium text-ink">{profile.one_line}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                {profile.creator && <div><div className="label mb-1.5">The creator</div><p className="text-[13.5px] text-ink-2">{profile.creator}</p></div>}
                {profile.audience && <div><div className="label mb-1.5">The audience</div><p className="text-[13.5px] text-ink-2">{profile.audience}</p></div>}
              </div>
              {profile.evolution && <div><div className="label mb-1.5">How it changed over time</div><p className="text-[13.5px] text-ink-2">{profile.evolution}</p></div>}
              <div className="grid gap-4 md:grid-cols-3">
                <List title="Strengths" items={profile.strengths} />
                <List title="Keeps coming up: requests" items={profile.recurring_requests} />
                <List title="Keeps coming up: complaints" items={profile.recurring_complaints} />
              </div>
              <List title="Opportunities" items={profile.opportunities} />
            </div>
          )}
          {months.length > 0 && (
            <div>
              <div className="label mb-2">Month by month</div>
              <ol className="space-y-2">
                {months.map((m) => (
                  <li key={m.month}>
                    <details className="group rounded-xl border border-line bg-white/[0.02] px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-center gap-3 text-[13.5px]">
                        <span className="w-16 shrink-0 tabular font-medium text-ink">{m.month}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-2">{m.mood ? `${m.mood} · ` : ""}{String(m.summary ?? "").slice(0, 140)}</span>
                        {m.stats && <span className="hidden shrink-0 tabular text-[12px] text-ink-3 sm:inline">{compact(m.stats.comments)} comments · mood {score(m.stats.mood)}</span>}
                      </summary>
                      <div className="mt-3 space-y-3 text-[13px] text-ink-2">
                        <p>{m.summary}</p>
                        {m.changes && <p><span className="text-ink-3">Changes:</span> {m.changes}</p>}
                        <div className="grid gap-3 md:grid-cols-3">
                          <List title="Liked" items={m.liked} /><List title="Complaints" items={m.complaints} /><List title="Requests" items={m.requests} />
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
