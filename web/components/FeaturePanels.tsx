import { ArrowDownRight, ArrowUpRight, Heart, MessageCircle } from "lucide-react";
import Link from "next/link";
import type { Alert } from "@/lib/alerts";
import type { Commenter, Prediction, TopicTrend } from "@/lib/features";
import { ago, compact, score } from "@/lib/format";
import { TopicChart } from "./charts/TopicChart";
import { Empty, Panel } from "./ui";

function PeopleList({ people, tone, channelId }: { people: Commenter[]; tone: "pos" | "neg" | "all"; channelId: string }) {
  if (!people.length) return <p className="text-[13px] text-ink-3">Nobody yet (needs a few comments from the same person).</p>;
  return (
    <ul className="space-y-1.5">
      {people.map((p) => {
        const trend = p.recent_avg != null && p.avg_sentiment != null ? p.recent_avg - p.avg_sentiment : null;
        return (
          <li key={p.author_channel_id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-white/[0.03]">
            <Link href={`/people/${p.author_channel_id}?c=${channelId}`} className="min-w-0 flex-1 truncate text-ink hover:text-accent" title="See all their comments">{p.author_name}</Link>
            <span className="flex items-center gap-1 tabular text-ink-3"><MessageCircle size={12} />{p.comments}</span>
            <span className="flex items-center gap-1 tabular text-ink-3"><Heart size={12} />{compact(p.likes)}</span>
            <span className={`w-10 text-right tabular ${tone === "pos" || (tone === "all" && (p.avg_sentiment ?? 0) > 0.2) ? "text-[#9cc5f5]" : tone === "neg" || (p.avg_sentiment ?? 0) < -0.1 ? "text-[#f3a9a9]" : "text-ink-2"}`}>{score(p.avg_sentiment)}</span>
            <span className="w-14 text-right text-[11.5px] text-ink-3" title="Last 30 days compared with their overall average">
              {trend == null ? "" : trend > 0.1 ? "warming" : trend < -0.1 ? "cooling" : "steady"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SuperfansPanel({ top, superfans, critics, channelId }: { top: Commenter[]; superfans: Commenter[]; critics: Commenter[]; channelId: string }) {
  return (
    <Panel title="Top commenters, superfans & critics" subtitle="Click a name to see every comment they wrote. Mood is their average, −100 … +100">
      <div className="grid gap-5 lg:grid-cols-3">
        <div><div className="label mb-2">🏆 Top commenters</div><PeopleList people={top} tone="all" channelId={channelId} /></div>
        <div><div className="label mb-2">💙 Superfans</div><PeopleList people={superfans} tone="pos" channelId={channelId} /></div>
        <div><div className="label mb-2">⚠️ Critics</div><PeopleList people={critics} tone="neg" channelId={channelId} /></div>
      </div>
    </Panel>
  );
}

export function TopicTrendsPanel({ trend }: { trend: TopicTrend }) {
  return (
    <Panel title="Topic trends" subtitle="What comments talk about each month (from the AI's reading), and what's rising or fading lately">
      {!trend.series.length ? <Empty>Appears after the AI has read comments.</Empty> : (
        <div className="grid gap-5 xl:grid-cols-[1fr_280px]">
          <TopicChart months={trend.months} series={trend.series} />
          <div>
            <div className="label mb-2">Last 30 days vs the 90 before</div>
            {!trend.rising.length ? <p className="text-[13px] text-ink-3">Not enough recent data yet.</p> : (
              <ul className="space-y-2">
                {trend.rising.map((r) => (
                  <li key={r.label} className="flex items-center gap-2 text-[13px]">
                    {r.change >= 0 ? <ArrowUpRight size={15} className="text-accent" /> : <ArrowDownRight size={15} className="text-ink-3" />}
                    <span className="flex-1 text-ink-2">{r.label}</span>
                    <span className="tabular text-ink">{r.recent.toFixed(0)}%</span>
                    <span className="w-14 text-right tabular text-[12px] text-ink-3">{r.change >= 0 ? "+" : ""}{r.change.toFixed(0)} pts</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function PredictionBadge({ p }: { p: Prediction }) {
  const idx = p.index;
  const label = idx == null ? "too early to tell" : idx >= 1.5 ? "well above usual" : idx >= 1.1 ? "above usual" : idx >= 0.9 ? "on track" : idx >= 0.6 ? "below usual" : "well below usual";
  const color = idx == null ? "text-ink-3" : idx >= 1.1 ? "text-accent" : idx >= 0.9 ? "text-ink" : "text-warn";
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      <div className="label">Early performance · {Math.round(p.age_hours)} h old</div>
      <div className={`mt-1 font-[family-name:var(--font-display)] text-xl font-semibold ${color}`}>{label}{idx != null && ` (${idx.toFixed(1)}×)`}</div>
      <div className="mt-1 text-[12.5px] text-ink-2 tabular">
        {compact(p.views)} views now{p.expected_views_now != null && ` · usual at this age ≈ ${compact(p.expected_views_now)}`}
        {p.projected_7d != null && ` · ≈ ${compact(p.projected_7d)} by day 7`}
      </div>
      <div className="mt-1 text-[11.5px] text-ink-3">Estimate based on {p.basis}.</div>
    </div>
  );
}

export function NewVideosPanel({ preds }: { preds: Prediction[] }) {
  if (!preds.length) return null;
  return (
    <Panel title="New videos: early performance" subtitle="Videos from the last 7 days compared with each channel's usual (estimate)">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {preds.slice(0, 6).map((p) => (
          <Link key={p.video_id} href={`/videos/${p.video_id}`} className="block transition hover:opacity-90">
            <div className="mb-1.5 line-clamp-1 text-[13.5px] text-ink">{p.title}</div>
            <PredictionBadge p={p} />
          </Link>
        ))}
      </div>
    </Panel>
  );
}

const KIND_ICON: Record<string, string> = { upload: "🎬", negative: "⚠️", viral: "🔥" };

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <Panel title="Alerts" subtitle="New uploads, negative spikes and viral comments">
      {!alerts.length ? <Empty>No alerts yet. They appear here (and on Telegram, if connected) as things happen.</Empty> : (
        <ul className="space-y-2">
          {alerts.slice(0, 8).map((a) => (
            <li key={a.id}>
              <Link href={a.link ?? "#"} className="block rounded-xl border border-line bg-white/[0.02] p-3 transition hover:border-accent/40">
                <div className="flex items-center gap-2 text-[13px] text-ink">{KIND_ICON[a.kind] ?? "•"}<span className="truncate">{a.title.replace(/^\S+\s/, "")}</span>
                  <span className="ml-auto shrink-0 text-[11.5px] text-ink-3">{ago(a.created_at)}</span></div>
                <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{a.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
