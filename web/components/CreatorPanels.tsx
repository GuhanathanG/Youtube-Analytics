import Link from "next/link";
import { Heart, MessageCircleQuestion } from "lucide-react";
import type { BrandRow, Health, OpenQuestion } from "@/lib/creator-insights";
import { ASPECT_LABELS } from "@/lib/queries-shared";
import { ago, compact, score } from "@/lib/format";
import { Sparkline } from "./AnalyticsParts";
import { Empty, Panel, Tag } from "./ui";

const ring = (s: number | null) => (s === null ? "#7c869b" : s >= 80 ? "#8db39a" : s >= 65 ? "#c8a97e" : s >= 45 ? "#d3a657" : "#c98479");

/** 7. Channel health: one 0–100 score from six parts, with the last 8 weeks. */
export function HealthCard({ h }: { h: Health }) {
  const c = ring(h.score);
  const pct = h.score ?? 0;
  return (
    <Panel title="Channel health" subtitle="One score from growth, engagement, mood, loyalty, consistency and momentum (0–100)">
      <div className="grid gap-5 md:grid-cols-[150px_1fr] md:items-center">
        <div className="relative mx-auto h-[130px] w-[130px]" role="img" aria-label={`Health score ${h.score ?? "not available"}: ${h.grade}`}>
          <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${pct} 100`} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div><div className="text-3xl font-light tabular text-ink">{h.score ?? "–"}</div>
              <div className="text-[11.5px]" style={{ color: c }}>{h.grade}</div></div>
          </div>
        </div>
        <div>
          {h.parts.length ? (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {h.parts.map((p) => (
                <li key={p.key}>
                  <div className="mb-1 flex items-baseline justify-between text-[13px]"><span className="text-ink-2">{p.label}</span><span className="tabular text-ink">{p.score}</span></div>
                  <div className="h-1.5 rounded-full bg-white/5"><div className="h-1.5 rounded-full" style={{ width: `${p.score}%`, background: ring(p.score) }} /></div>
                  <div className="mt-0.5 text-[11.5px] text-ink-3">{p.detail}</div>
                </li>
              ))}
            </ul>
          ) : <Empty>Builds up as data is collected.</Empty>}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-ink-3">
            <span className="flex items-center gap-2">Mood, last 8 weeks <Sparkline values={h.weekly.map((w) => (w.mood === null ? 0 : (w.mood + 1) * 50))} /></span>
            <span className="flex items-center gap-2">Comments per week <Sparkline values={h.weekly.map((w) => w.comments)} color="#9c8467" /></span>
            <span>Uploads: {h.weekly.map((w) => w.uploads).join(" · ")}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** 5. Brands & sponsors seen in analysed videos, with how viewers talk about them. */
export function BrandsPanel({ brands }: { brands: BrandRow[] }) {
  return (
    <Panel title="Brands, products & sponsors" subtitle="Named or shown in videos the AI watched; mentions and mood from the last year of comments">
      {brands.length ? (
        <div className="scrollbar-thin -mx-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13.5px]">
            <thead><tr className="text-left">
              <th className="label px-2 py-2 font-normal">Name</th><th className="label px-2 py-2 text-right font-normal">Videos</th>
              <th className="label px-2 py-2 text-right font-normal">Sponsored</th><th className="label px-2 py-2 text-right font-normal">Comment mentions</th>
              <th className="label px-2 py-2 text-right font-normal">Viewer mood</th></tr></thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.name} className="border-t border-line align-top">
                  <td className="px-2 py-2"><div className="text-ink">{b.name}</div>
                    <div className="mt-0.5 truncate text-[12px] text-ink-3">{b.examples.map((e, i) => <span key={e.id}>{i ? " · " : ""}<Link href={`/videos/${e.id}`} className="hover:text-accent">{e.title.slice(0, 40)}</Link></span>)}</div></td>
                  <td className="px-2 py-2 text-right tabular text-ink-2">{b.videos}</td>
                  <td className="px-2 py-2 text-right">{b.sponsored ? <Tag tone="warn">{b.sponsored}</Tag> : <span className="text-ink-3">–</span>}</td>
                  <td className="px-2 py-2 text-right tabular text-ink-2">{compact(b.mentions)}</td>
                  <td className={`px-2 py-2 text-right tabular ${(b.mood ?? 0) < -0.1 ? "text-neg" : (b.mood ?? 0) > 0.2 ? "text-pos" : "text-ink-2"}`}>{b.mentions ? score(b.mood) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Appears once the AI has watched some of this channel&apos;s videos (Manage → AI video analysis).</Empty>}
    </Panel>
  );
}

/** 6. The most-liked viewer questions the creator never answered. */
export function QuestionsList({ questions, limit = 10 }: { questions: OpenQuestion[]; limit?: number }) {
  if (!questions.length) return <Empty>No unanswered questions found yet (needs comments read by the AI or the local model).</Empty>;
  const groups = new Map<string, OpenQuestion[]>();
  for (const q of questions.slice(0, limit)) {
    const key = q.aspect && ASPECT_LABELS[q.aspect] ? ASPECT_LABELS[q.aspect] : "General";
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([topic, qs]) => (
        <div key={topic}>
          <div className="label mb-2">{topic}</div>
          <ul className="space-y-2">
            {qs.map((q) => (
              <li key={q.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                <div className="flex items-start gap-2.5">
                  <MessageCircleQuestion size={16} className="mt-0.5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] text-ink">{q.text}</p>
                    {q.translation && <p className="mt-1 text-[12.5px] italic text-ink-3">{q.translation}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                      <span className="flex items-center gap-1 tabular"><Heart size={11} />{compact(q.like_count)}</span>
                      <span>{q.author_name ?? "Viewer"} · {ago(q.published_at)}</span>
                      <Link href={`/videos/${q.video_id}`} className="truncate hover:text-accent">{q.video_title}</Link>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
