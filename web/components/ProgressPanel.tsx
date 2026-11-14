import type { Progress } from "@/lib/queries";
import { Countdown } from "./Countdown";
import { Panel } from "./ui";

const fmt = (n: number) => Math.round(n).toLocaleString("en");

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 100;
  return (
    <div className="h-1.5 rounded-full bg-white/5">
      <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 10px ${color}55` }} />
    </div>
  );
}

type Job = { key: string; label: string; done: number; total: number; left: number; perHour: number; unit: string; note: string; color: string; doneNote?: string };

/** Finish time (ms) for `left` items at `perHour`, or null when nothing is moving yet. 0 = done. */
const finishAt = (left: number, perHour: number, now: number): number | null => (left <= 0 ? 0 : perHour > 0 ? now + (left / perHour) * 3600_000 : null);

/** Every job per channel with what's left, its speed and a live countdown, plus when everything will be done. */
export function ProgressPanel({ rows }: { rows: Progress[] }) {
  if (!rows.length) return null;
  const now = Date.now();
  // The slower AI jobs share one pace across all channels; split it between channels that still have work.
  const share = (key: "videos_to_watch" | "thumbs_to_check" | "months_to_remember") => Math.max(1, rows.filter((r) => (r[key] ?? 0) > 0).length);

  return (
    <Panel title="Jobs & time left" subtitle="Every job for each channel, how fast it's going (last hour, or the last day for slow jobs) and when it should be done. Jobs run in parallel.">
      <div className="space-y-6">
        {rows.map((p) => {
          // A handful of videos are always "missing" (private, removed, members-only): not a job left to do.
          const videosGap = p.videos_total ? Math.max(0, p.videos_total - p.videos_known) : 0;
          const videosLeft = videosGap > Math.max(5, (p.videos_total ?? 0) * 0.01) ? videosGap : 0;
          // History is done when every video's comments are downloaded. YouTube's count also includes replies and
          // hidden or deleted comments the API never returns, so stored < YouTube's number is normal.
          const historyDone = (p.history_left ?? 1) === 0;
          const commentsLeft = historyDone ? 0 : Math.max(0, p.comments_on_youtube - p.comments_stored);
          // Reading jobs work on the main database; older comments moved to the archive are kept as they were.
          const inMain = Math.max(0, p.comments_stored - (p.archived ?? 0));
          const sWait = p.sentiment_waiting ?? Math.max(0, p.comments_stored - p.sentiment_done);
          const aWait = p.ai_waiting ?? Math.max(0, p.comments_stored - p.ai_read);
          const archivedNote = p.archived ? ` · ${fmt(p.archived)} older ones kept in the archive` : "";
          const jobs: Job[] = [
            { key: "videos", label: "Find every video", done: p.videos_known, total: Math.max(p.videos_total ?? 0, p.videos_known), left: videosLeft,
              perHour: videosLeft ? 3000 / Math.max(1, rows.filter((r) => r.videos_total && r.videos_total > r.videos_known).length) : 0, unit: "videos",
              note: "about 100 videos every 2 minutes (estimate)", color: "#8b7cf6",
              doneNote: videosGap ? `${fmt(videosGap)} private or removed` : undefined },
            { key: "comments", label: "Download comment history", done: p.comments_stored, total: historyDone ? p.comments_stored : Math.max(p.comments_on_youtube, p.comments_stored),
              left: commentsLeft, perHour: p.saved_last_hour, unit: "comments", note: `${fmt(p.saved_last_hour)}/hour`, color: "#22d3ee",
              doneNote: historyDone && p.comments_on_youtube > p.comments_stored ? "every video downloaded (YouTube's total also counts hidden replies)" : undefined },
            { key: "sentiment", label: "Sentiment & language (local model)", done: Math.max(0, inMain - sWait), total: inMain,
              left: sWait + commentsLeft, perHour: p.sentiment_last_hour, unit: "comments",
              note: `${fmt(p.sentiment_last_hour)}/hour · runs every 30 min`, color: "#0ca30c", doneNote: archivedNote ? `all caught up${archivedNote}` : undefined },
            { key: "ai", label: "AI reads every comment", done: Math.max(0, inMain - aWait), total: inMain,
              left: aWait + commentsLeft, perHour: p.ai_last_hour, unit: "comments",
              note: `${fmt(p.ai_last_hour)}/hour`, color: "#3987e5", doneNote: archivedNote ? `all caught up${archivedNote}` : undefined },
          ];
          if (p.videos_to_watch != null) jobs.push({ key: "watch", label: "AI watches new videos (30 days)", done: 0, total: 0, left: p.videos_to_watch,
            perHour: (p.watch_per_hour ?? 0) / share("videos_to_watch"), unit: "videos", note: "about 1 every 2 hours", color: "#fab219" });
          if (p.thumbs_to_check != null) jobs.push({ key: "thumbs", label: "AI checks thumbnails", done: 0, total: 0, left: p.thumbs_to_check,
            perHour: (p.thumbs_per_hour ?? 0) / share("thumbs_to_check"), unit: "thumbnails", note: "up to 75 every 2 hours", color: "#e66767" });
          if (p.months_to_remember != null) jobs.push({ key: "memory", label: "Creator Memory (months)", done: 0, total: 0, left: p.months_to_remember,
            perHour: (p.memory_per_hour ?? 0) / share("months_to_remember"), unit: "months", note: "about 6 an hour across channels", color: "#8b7cf6" });
          const finishes = jobs.map((j) => finishAt(j.left, j.perHour, now));
          const overall = finishes.some((f) => f === null) ? null : Math.max(0, ...(finishes as number[]));
          const allDone = jobs.every((j) => j.left <= 0);
          return (
            <div key={p.channel_id}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium text-ink">{p.title}</span>
                <span className="rounded-lg border border-line bg-white/[0.03] px-2.5 py-1 text-[12.5px]">
                  <span className="text-ink-3">All jobs done: </span>
                  {allDone ? <span className="text-good">✓ complete</span>
                    : overall === null ? <span className="text-ink-2">once every job is moving</span>
                    : <Countdown at={overall} className="tabular text-ink" />}
                </span>
              </div>
              <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                {jobs.map((j, i) => (
                  <li key={j.key}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                      <span className="label">{j.label}</span>
                      <span className="tabular text-ink-2">{j.total ? `${fmt(j.done)} / ${fmt(j.total)}` : j.left ? `${fmt(j.left)} ${j.unit} left` : "nothing waiting"}</span>
                    </div>
                    <Bar value={j.total ? j.done : j.left ? 0 : 1} total={j.total || 1} color={j.color} />
                    <div className="mt-1 flex justify-between gap-2 text-[12px] text-ink-3">
                      <span>{j.left > 0 ? j.note : j.doneNote ? `done · ${j.doneNote}` : "done"}</span>
                      {j.left > 0 && <Countdown at={finishes[i]} className="tabular text-ink-2" />}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
