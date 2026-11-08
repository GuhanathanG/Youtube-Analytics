import { ChevronLeft } from "lucide-react";
import { isInstagram, postUrl } from "@/lib/platform";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AspectChart } from "@/components/charts/lazy";
import { BarList } from "@/components/charts/BarList";
import { GrowthChart } from "@/components/charts/lazy";
import { MixBar } from "@/components/charts/MixBar";
import { TrendChart } from "@/components/charts/lazy";
import { CommentCard } from "@/components/CommentCard";
import { InsightPanel } from "@/components/InsightPanel";
import { PredictionBadge } from "@/components/FeaturePanels";
import { predictions } from "@/lib/features";
import { forecastFor } from "@/lib/engine-model";
import { AIWatchPanel, DetailsPanel, MomentsPanel, PerformancePanel, ThumbnailPanel } from "@/components/VideoAnalysis";
import { thumbnailsFor } from "@/lib/thumbnails";
import { ownerReport } from "@/lib/owner";
import { liveChatStats } from "@/lib/livechat";
import { LiveChatPanel } from "@/components/LiveChatPanel";
import { videoAdvanced } from "@/lib/analytics";
import { commentMoments, durationSeconds, getAnalysis, performance } from "@/lib/video";
import { Reveal } from "@/components/Reveal";
import { Empty, Panel, Stat } from "@/components/ui";
import { compact, date, duration } from "@/lib/format";
import {
  aspectCounts, comments, dailySentiment, emotionCounts, languageCounts, latestInsight, sentimentMix,
  video as getVideo, videoSnapshots, type CommentOrder, type Filters,
} from "@/lib/queries";

const TABS: { key: string; label: string; order: CommentOrder; extra: Partial<Filters> }[] = [
  { key: "liked", label: "👍 Most liked", order: "most_liked", extra: { topLevelOnly: true, hideSpam: true } },
  { key: "positive", label: "💙 Most positive", order: "most_positive", extra: { hideSpam: true } },
  { key: "negative", label: "🔥 Most negative", order: "most_negative", extra: { hideSpam: true } },
  { key: "questions", label: "❓ Questions", order: "most_liked", extra: { flag: "question" } },
  { key: "requests", label: "💡 Requests", order: "most_liked", extra: { flag: "suggestion" } },
  { key: "newest", label: "🕒 Newest", order: "newest", extra: {} },
];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const v = await getVideo((await params).id);
  return { title: v?.title ?? "Video" };
}

export default async function VideoPage({ params, searchParams }:
  { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const tabKey = (await searchParams).tab;
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];
  const v = await getVideo(id);
  if (!v) notFound();
  const f = { videoId: id };
  const durS = durationSeconds(v.duration);
  // One round for everything (it used to wait for the first half before starting the second).
  const [insight, mix, daily, langs, emos, aspects, snaps, list, preds, perf, analysis, momentData, adv, fc] = await Promise.all([
    latestInsight("video", id), sentimentMix(f), dailySentiment(f), languageCounts(f), emotionCounts(f),
    aspectCounts(f), videoSnapshots(id), comments({ ...f, ...tab.extra }, tab.order, 60), predictions(v.channel_id).catch(() => []),
    performance(id).catch(() => null), getAnalysis(id).catch(() => null), commentMoments(id, durS).catch(() => ({ moments: [], histogram: [] })),
    videoAdvanced(id, v.channel_id).catch(() => null), forecastFor(id),
  ]);
  const prediction = preds.find((p) => p.video_id === id);
  const thumb = (await thumbnailsFor(v.channel_id)).get(id);
  const chat = await liveChatStats(id).catch(() => null);
  const owner = await ownerReport(v.channel_id).catch(() => null);
  const mine = owner?.videos.find((x) => x.id === id) ?? null;
  const chapters = ((analysis?.data?.chapters as { start: string; title: string }[] | undefined) ?? []);

  return (
    <>
      <Link href={`/channels/${v.channel_id}`} className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-accent">
        <ChevronLeft size={15} />{v.channel_title}
      </Link>
      <Reveal>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="panel overflow-hidden p-1.5">
            <div className="aspect-video overflow-hidden rounded-[14px] bg-black">
              {isInstagram(id) ? (
                <a href={postUrl(id)} target="_blank" rel="noreferrer" className="block h-full w-full">
                  {v.thumbnail_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={v.thumbnail_url} alt="" className="h-full w-full object-contain" referrerPolicy="no-referrer" />
                    : <div className="grid h-full place-items-center text-ink-2">Open on Instagram</div>}
                </a>
              ) : (
                <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${id}`} title={v.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
              )}
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <div className="label">{isInstagram(id) ? "Instagram post" : "Video"} · {date(v.published_at)} {v.duration && `· ${duration(v.duration)}`}</div>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{v.title}</h1>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Stat label="Views" value={v.view_count ?? 0} accent />
              <Stat label="Likes" value={v.like_count ?? 0} />
              <Stat label="Comments" value={v.comments_stored} hint={`${(v.comments_on_youtube ?? 0).toLocaleString("en")} on ${isInstagram(id) ? "Instagram" : "YouTube"}`} />
              <Stat label="Sentiment" value={Math.round((v.avg_sentiment ?? 0) * 100)} format="signed" hint="−100 … +100" />
            </div>
            <div className="mt-5"><MixBar mix={mix} /></div>
            {prediction && <div className="mt-4"><PredictionBadge p={prediction} /></div>}
            {fc && (
              <Link href="/predict" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[13px] text-ink-2 hover:border-accent/40">
                <span className="label">Engine forecast</span>
                <span className="text-ink tabular">~{compact(fc.views_30d)} views in 30 days</span>
                <span className="text-ink-3 tabular">({compact(fc.low)}–{compact(fc.high)})</span>
                <span className={`tabular ${fc.vs_normal >= 1.5 ? "text-pos" : fc.vs_normal <= 0.6 ? "text-neg" : ""}`}>{Number(fc.vs_normal).toFixed(1)}× normal</span>
              </Link>
            )}
          </div>
        </div>
      </Reveal>

      {mine && (
        <Reveal className="mt-6"><section className="panel p-5">
          <div className="font-mono text-[10.5px] tracking-[0.3em] text-accent">PRIVATE ANALYTICS · LAST 28 DAYS</div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["Views", mine.views.toLocaleString("en")], ["Watch time", `${Math.round(mine.minutes / 60).toLocaleString("en")} h`],
              ["Avg view", `${Math.floor(mine.avgViewDuration / 60)}:${String(Math.round(mine.avgViewDuration % 60)).padStart(2, "0")}`],
              ["Avg % watched", `${mine.avgViewPct.toFixed(0)}%`]] as [string, string][]).map(([k, val]) => (
              <div key={k} className="rounded-xl border border-accent/20 bg-accent/[0.04] px-3 py-2.5"><div className="label">{k}</div>
                <div className="mt-1 font-[family-name:var(--font-display)] text-[18px] font-semibold tabular">{val}</div></div>
            ))}
          </div>
          {owner && owner.totals.avgViewPct !== null && (
            <p className="mt-3 text-[13px] text-ink-2">Channel average: {owner.totals.avgViewPct.toFixed(0)}% watched. {mine.avgViewPct < owner.totals.avgViewPct * 0.8
              ? "This video loses viewers faster than usual: check the first 30 seconds and any slow sections."
              : mine.avgViewPct > owner.totals.avgViewPct * 1.2 ? "Viewers stay longer than usual on this one: its pacing is worth repeating." : "Retention is in line with the channel."}</p>
          )}
        </section></Reveal>
      )}
      {chat && <Reveal className="mt-6"><LiveChatPanel s={chat} /></Reveal>}
      {perf && <Reveal delay={0.05} className="mt-6"><PerformancePanel perf={perf} adv={adv} /></Reveal>}
      {thumb && <Reveal delay={0.05} className="mt-4"><ThumbnailPanel t={thumb} /></Reveal>}
      {(!isInstagram(id) || v.duration || analysis) && <Reveal delay={0.1} className="mt-4"><AIWatchPanel videoId={id} analysis={analysis} hasKey={!!process.env.GEMINI_API_KEY} /></Reveal>}
      {!isInstagram(id) && <Reveal delay={0.1} className="mt-4"><MomentsPanel videoId={id} durationS={durS} moments={momentData.moments} histogram={momentData.histogram} chapters={chapters} /></Reveal>}
      <Reveal delay={0.1} className="mt-4"><InsightPanel insight={insight} scope="video" /></Reveal>
      {perf && <Reveal delay={0.1} className="mt-4"><DetailsPanel perf={perf} /></Reveal>}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="When people commented">
          {daily.length ? <TrendChart data={daily} height={240} /> : <Empty>No comments yet.</Empty>}
        </Panel>
        <Panel title="Languages"><BarList rows={langs.map((l) => ({ label: l.name, value: l.comments }))} empty="Appears after analysis." /></Panel>
        <Panel className="xl:col-span-2" title="Praise vs criticism">
          {aspects.length ? <AspectChart data={aspects} /> : <Empty>Appears after the AI has read comments.</Empty>}
        </Panel>
        <Panel title="Emotions">
          <BarList color="#8b7cf6" rows={emos.filter((e) => e.emotion !== "neutral").map((e) => ({ label: `${e.icon} ${e.emotion}`, value: e.comments }))}
            empty="Appears after the AI has read comments." />
        </Panel>
      </div>

      {snaps.length > 1 && (
        <Panel className="mt-4" title="Views since tracking started"><GrowthChart data={snaps} dataKey="views" name="Views" /></Panel>
      )}

      <section className="mt-6">
        <div className="scrollbar-thin -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">
          {TABS.map((t) => (
            <Link key={t.key} href={`/videos/${id}?tab=${t.key}`} scroll={false} role="tab" aria-selected={t.key === tab.key}
              className={`shrink-0 rounded-xl border px-3.5 py-2 text-[13px] transition ${t.key === tab.key ? "border-accent/50 bg-accent/10 text-ink" : "border-line bg-white/[0.02] text-ink-2 hover:border-line-2"}`}>
              {t.label}
            </Link>
          ))}
        </div>
        {list.length === 0 ? <Empty>No comments here yet.</Empty> : (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {list.map((c) => <CommentCard key={c.id} c={c} showVideo={false} />)}
          </div>
        )}
      </section>
    </>
  );
}
