import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AspectChart } from "@/components/charts/AspectChart";
import { BarList } from "@/components/charts/BarList";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { MixBar } from "@/components/charts/MixBar";
import { TrendChart } from "@/components/charts/TrendChart";
import { CommentCard } from "@/components/CommentCard";
import { InsightPanel } from "@/components/InsightPanel";
import { PredictionBadge } from "@/components/FeaturePanels";
import { predictions } from "@/lib/features";
import { Reveal } from "@/components/Reveal";
import { Empty, Panel, Stat } from "@/components/ui";
import { date, duration } from "@/lib/format";
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
  const [insight, mix, daily, langs, emos, aspects, snaps, list] = await Promise.all([
    latestInsight("video", id), sentimentMix(f), dailySentiment(f), languageCounts(f), emotionCounts(f),
    aspectCounts(f), videoSnapshots(id), comments({ ...f, ...tab.extra }, tab.order, 60),
  ]);
  const prediction = (await predictions(v.channel_id).catch(() => [])).find((p) => p.video_id === id);

  return (
    <>
      <Link href={`/channels/${v.channel_id}`} className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-accent">
        <ChevronLeft size={15} />{v.channel_title}
      </Link>
      <Reveal>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="panel overflow-hidden p-1.5">
            <div className="aspect-video overflow-hidden rounded-[14px] bg-black">
              <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${id}`} title={v.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <div className="label">Video · {date(v.published_at)} {v.duration && `· ${duration(v.duration)}`}</div>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{v.title}</h1>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Stat label="Views" value={v.view_count ?? 0} accent />
              <Stat label="Likes" value={v.like_count ?? 0} />
              <Stat label="Comments" value={v.comments_stored} hint={`${(v.comments_on_youtube ?? 0).toLocaleString("en")} on YouTube`} />
              <Stat label="Sentiment" value={Math.round((v.avg_sentiment ?? 0) * 100)} format="signed" hint="−100 … +100" />
            </div>
            <div className="mt-5"><MixBar mix={mix} /></div>
            {prediction && <div className="mt-4"><PredictionBadge p={prediction} /></div>}
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.1} className="mt-6"><InsightPanel insight={insight} scope="video" /></Reveal>

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
