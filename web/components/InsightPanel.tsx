import { Sparkles } from "lucide-react";
import type { Insight } from "@/lib/queries";
import { ago } from "@/lib/format";
import { Tag } from "./ui";

type Topic = { name?: string; share_pct?: number; sentiment?: string; example?: string };

function List({ title, icon, items, tone }: { title: string; icon: string; items: unknown; tone?: "pos" | "neg" | "accent" }) {
  const list = Array.isArray(items) ? (items.filter(Boolean) as string[]) : [];
  const bar = tone === "pos" ? "bg-pos" : tone === "neg" ? "bg-neg" : "bg-accent";
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-ink"><span>{icon}</span>{title}</div>
      {list.length === 0 ? <p className="text-[13px] text-ink-3">Nothing notable yet.</p> : (
        <ul className="space-y-2">
          {list.slice(0, 6).map((t, i) => (
            <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-ink-2">
              <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${bar}`} />{t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function InsightPanel({ insight, scope }: { insight: Insight | null; scope: "video" | "channel" }) {
  if (!insight) {
    return (
      <section className="panel relative overflow-hidden p-6">
        <div className="flex items-center gap-2 text-[15px] font-semibold"><Sparkles size={17} className="text-accent" />AI briefing</div>
        <p className="mt-2 text-[13.5px] text-ink-3">
          Not written yet. The AI writes a briefing once there are at least 20 comments, on the next scheduled run.
        </p>
      </section>
    );
  }
  const d = insight.data as Record<string, unknown>;
  const topics = (Array.isArray(d.topics) ? d.topics : []) as Topic[];
  return (
    <section className="panel relative overflow-hidden p-6">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent-2/20 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[16px] font-semibold">
          <Sparkles size={17} className="text-accent" />AI briefing
        </div>
        {typeof d.mood === "string" && <Tag tone="accent">{d.mood}</Tag>}
        {typeof d.trend === "string" && <Tag tone="accent">{d.trend}</Tag>}
        <span className="ml-auto text-[12px] text-ink-3">{ago(insight.created_at)} · {insight.comment_count.toLocaleString("en")} comments · {insight.model}</span>
      </div>
      {typeof d.summary === "string" && <p className="relative mt-4 max-w-[85ch] text-[15px] leading-relaxed text-ink">{d.summary}</p>}
      {typeof d.audience_profile === "string" && (
        <p className="relative mt-3 text-[13.5px] text-ink-2"><span className="label mr-2">Audience</span>{d.audience_profile}</p>
      )}
      <div className="relative mt-5 grid gap-3 md:grid-cols-3">
        <List title="What viewers love" icon="💙" items={d.liked} tone="pos" />
        <List title="Complaints" icon="⚠️" items={d.complaints} tone="neg" />
        <List title="Requests" icon="💡" items={d.requests} tone="accent" />
        {scope === "channel" ? (
          <>
            <List title="Best received" icon="🏆" items={d.best_videos} tone="pos" />
            <List title="Weakest" icon="📉" items={d.worst_videos} tone="neg" />
            <List title="Content ideas" icon="🎯" items={d.content_ideas} tone="accent" />
          </>
        ) : Array.isArray(d.questions) && d.questions.length > 0 ? (
          <div className="md:col-span-3"><List title="Unanswered questions" icon="❓" items={d.questions} tone="accent" /></div>
        ) : null}
      </div>
      {topics.length > 0 && (
        <div className="relative mt-5">
          <div className="label mb-2">What people talk about</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {topics.slice(0, 6).map((t, i) => {
              const color = t.sentiment === "positive" ? "#3987e5" : t.sentiment === "negative" ? "#e66767" : "#8a8f9c";
              return (
                <div key={i} className="rounded-xl border border-line bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between gap-3 text-[13.5px]">
                    <span className="font-medium text-ink">{t.name}</span>
                    <span className="tabular text-ink-2">{Math.round(Number(t.share_pct ?? 0))}%</span>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-white/5">
                    <div className="h-1 rounded-full" style={{ width: `${Math.min(100, Number(t.share_pct ?? 0))}%`, background: color }} />
                  </div>
                  {t.example && <p className="mt-2 line-clamp-2 text-[12.5px] italic text-ink-3">“{t.example}”</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {typeof d.language_notes === "string" && <p className="relative mt-4 text-[12.5px] text-ink-3">🌐 {d.language_notes}</p>}
    </section>
  );
}
