import type { Progress } from "@/lib/queries";
import { Panel } from "./ui";

function eta(remaining: number, perHour: number): string {
  if (remaining <= 0) return "done";
  if (perHour <= 0) return "waiting to start";
  const h = remaining / perHour;
  if (h < 1) return `~${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `~${Math.round(h)} h`;
  return `~${Math.round(h / 24)} days`;
}

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-white/5">
      <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 10px ${color}55` }} />
    </div>
  );
}

const fmt = (n: number) => Math.round(n).toLocaleString("en");

/** How far the history download and the AI reading have got, with an estimate of time left. */
export function ProgressPanel({ rows }: { rows: Progress[] }) {
  if (!rows.length) return null;
  return (
    <Panel title="History progress" subtitle="Downloading every past comment, then having the AI read them. Estimates use the last hour's speed.">
      <div className="space-y-5">
        {rows.map((p) => {
          const videosLeft = p.videos_total ? Math.max(0, p.videos_total - p.videos_known) : 0;
          const commentsLeft = Math.max(0, p.comments_on_youtube - p.comments_stored);
          const aiLeft = Math.max(0, p.comments_stored - p.ai_read);
          return (
            <div key={p.channel_id}>
              <div className="mb-2 text-[14px] font-medium text-ink">{p.title}</div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <div className="mb-1 flex justify-between text-[12.5px]"><span className="label">Videos found</span>
                    <span className="tabular text-ink-2">{fmt(p.videos_known)}{p.videos_total ? ` / ${fmt(p.videos_total)}` : ""}</span></div>
                  <Bar value={p.videos_known} total={p.videos_total ?? p.videos_known} color="#8b7cf6" />
                  <div className="mt-1 text-[12px] text-ink-3">{videosLeft ? `${fmt(videosLeft)} older videos still to list` : "all videos listed"}</div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[12.5px]"><span className="label">Comments saved</span>
                    <span className="tabular text-ink-2">{fmt(p.comments_stored)} / {fmt(p.comments_on_youtube)}{videosLeft ? "+" : ""}</span></div>
                  <Bar value={p.comments_stored} total={p.comments_on_youtube} color="#22d3ee" />
                  <div className="mt-1 text-[12px] text-ink-3">
                    {commentsLeft || videosLeft ? `${fmt(p.saved_last_hour)}/hour · ${eta(commentsLeft, p.saved_last_hour)} left${videosLeft ? " (more as older videos are listed)" : ""}` : "complete"}
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[12.5px]"><span className="label">Read by AI</span>
                    <span className="tabular text-ink-2">{fmt(p.ai_read)} / {fmt(p.comments_stored)}</span></div>
                  <Bar value={p.ai_read} total={p.comments_stored} color="#3987e5" />
                  <div className="mt-1 text-[12px] text-ink-3">{aiLeft ? `${fmt(p.ai_last_hour)}/hour · ${eta(aiLeft, p.ai_last_hour)} left` : "all read"}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
