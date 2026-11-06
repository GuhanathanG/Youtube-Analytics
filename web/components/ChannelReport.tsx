/**
 * One-page channel report: used for the weekly report (/report/[id], printable as PDF) and for
 * read-only share links (/share/[token]). In "share" mode nothing links into the private site.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { HealthCard } from "./CreatorPanels";
import { OutlierBadge, Trend, times } from "./AnalyticsParts";
import { Empty, Panel } from "./ui";
import { channelAnalytics, channelTopics, type VideoPerf } from "@/lib/analytics";
import { brandTracker, channelHealth, unansweredQuestions } from "@/lib/creator-insights";
import { compact, score } from "@/lib/format";
import { channel as getChannel, latestInsight } from "@/lib/queries";

type Idea = { title?: string; why?: string; requests?: number };

function VideoLine({ v, share }: { v: VideoPerf; share: boolean }) {
  const title = <span className="min-w-0 flex-1 truncate text-ink">{v.title}</span>;
  return (
    <li className="flex items-center gap-3 py-1.5 text-[13.5px]">
      {share ? title : <Link href={`/videos/${v.id}`} className="min-w-0 flex-1 truncate text-ink hover:text-accent">{v.title}</Link>}
      <span className="tabular text-ink-3">{compact(v.views)} views</span>
      <OutlierBadge value={v.outlier} />
    </li>
  );
}

const Delta = ({ now, before, unit = "" }: { now: number | null; before: number | null; unit?: string }) => {
  if (now === null || before === null || before === 0) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  return <span className={`ml-1.5 text-[12px] ${pct >= 0 ? "text-accent" : "text-neg"}`}>{pct >= 0 ? "▲" : "▼"} {Math.abs(Math.round(pct))}%{unit}</span>;
};

export async function ChannelReport({ channelId, mode, footer }: { channelId: string; mode: "report" | "share"; footer?: ReactNode }) {
  const share = mode === "share";
  const [ch, a, health, topics, questions, ideas, brands] = await Promise.all([
    getChannel(channelId), channelAnalytics(channelId), channelHealth(channelId), channelTopics(channelId),
    unansweredQuestions(channelId, 5).catch(() => []), latestInsight("ideas", channelId).catch(() => null), brandTracker(channelId).catch(() => []),
  ]);
  if (!ch) return <Empty>Channel not found.</Empty>;
  const [prev, last] = health.weekly.slice(-2);
  const rising = topics.filter((t) => (t.trend_pct ?? 0) >= 10).slice(0, 3);
  const falling = topics.filter((t) => (t.trend_pct ?? 0) <= -10).slice(0, 2);
  const ideaList = ((ideas?.data.ideas as Idea[] | undefined) ?? []).slice(0, 5);
  const weekOf = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="report space-y-4">
      <header className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {ch.thumbnail_url && <img src={ch.thumbnail_url} alt="" className="h-14 w-14 rounded-full object-cover ring-1 ring-white/10" />}
        <div className="min-w-0">
          <div className="label">{share ? "Shared channel report" : "Weekly report"} · {weekOf}</div>
          <h1 className="truncate font-[family-name:var(--font-display)] text-2xl font-semibold text-ink">{ch.title}</h1>
          <div className="text-[13px] text-ink-3">{compact(ch.subscriber_count)} subscribers · {compact(ch.video_count)} videos · {compact(ch.comments)} comments analysed</div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4"><div className="label">Comments this week</div>
          <div className="mt-1 text-xl font-semibold tabular text-ink">{compact(last?.comments ?? 0)}<Delta now={last?.comments ?? null} before={prev?.comments ?? null} /></div></div>
        <div className="panel p-4"><div className="label">Mood this week</div>
          <div className="mt-1 text-xl font-semibold tabular text-ink">{score(last?.mood ?? null)}
            {last?.mood != null && prev?.mood != null && <span className={`ml-1.5 text-[12px] ${last.mood >= prev.mood ? "text-accent" : "text-neg"}`}>{last.mood >= prev.mood ? "▲" : "▼"} {Math.abs(Math.round((last.mood - prev.mood) * 100))} pts</span>}</div></div>
        <div className="panel p-4"><div className="label">Uploads this week</div>
          <div className="mt-1 text-xl font-semibold tabular text-ink">{last?.uploads ?? 0}<span className="ml-1.5 text-[12px] text-ink-3">last week {prev?.uploads ?? 0}</span></div></div>
      </div>

      <HealthCard h={health} />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Best videos" subtitle="Views vs the channel's usual (1× = typical)">
          {a.top.length ? <ul className="divide-y divide-line">{a.top.slice(0, 4).map((v) => <VideoLine key={v.id} v={v} share={share} />)}</ul> : <Empty>Not enough videos yet.</Empty>}
        </Panel>
        <Panel title="Weakest videos">
          {a.bottom.length ? <ul className="divide-y divide-line">{a.bottom.slice(0, 4).map((v) => <VideoLine key={v.id} v={v} share={share} />)}</ul> : <Empty>Not enough videos yet.</Empty>}
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Topics on the move" subtitle="Share of comments, last 14 days vs the 14 before">
          {rising.length || falling.length ? (
            <ul className="space-y-2 text-[13.5px]">
              {[...rising, ...falling].map((t) => (
                <li key={t.label} className="flex items-center gap-3"><span className="min-w-0 flex-1 truncate text-ink">{t.label}</span>
                  <span className="text-[12px] text-ink-3">mood {score(t.sentiment)}</span><Trend pct={t.trend_pct} /></li>
              ))}
            </ul>
          ) : <Empty>No big changes in topics.</Empty>}
        </Panel>
        <Panel title="Best time to upload" subtitle={`From past results (${a.timezone.replace("_", " ")})`}>
          {a.heatmap.best ? <p className="text-[15px] text-ink">{a.heatmap.best.day} {a.heatmap.best.block} h <span className="text-ink-3">· typically {times(a.heatmap.best.outlier)} the usual views ({a.heatmap.best.count} videos)</span></p>
            : <Empty>Needs more videos.</Empty>}
          {a.lengths.length > 0 && (() => {
            const bestLen = [...a.lengths].filter((l) => l.count >= 3 && l.outlier !== null).sort((x, y) => y.outlier! - x.outlier!)[0];
            return bestLen ? <p className="mt-2 text-[13.5px] text-ink-2">Best length: {bestLen.label} ({times(bestLen.outlier)})</p> : null;
          })()}
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Top unanswered questions">
          {questions.length ? <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] text-ink">{questions.map((q) => <li key={q.id}>{q.text} <span className="text-ink-3">({compact(q.like_count)} likes)</span></li>)}</ol>
            : <Empty>None found.</Empty>}
        </Panel>
        <Panel title="Content ideas from viewers">
          {ideaList.length ? <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] text-ink">{ideaList.map((i, n) => <li key={n}>{i.title} {i.requests ? <span className="text-ink-3">({i.requests} asking)</span> : null}</li>)}</ol>
            : <Empty>No ideas yet.</Empty>}
        </Panel>
      </div>

      {brands.length > 0 && (
        <Panel title="Brands & sponsors">
          <p className="text-[13.5px] text-ink-2">{brands.slice(0, 8).map((b) => `${b.name}${b.sponsored ? " (sponsor)" : ""}`).join(" · ")}</p>
        </Panel>
      )}
      {footer}
    </div>
  );
}
