import { ExternalLink, Play } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AspectChart } from "@/components/charts/AspectChart";
import { BarList } from "@/components/charts/BarList";
import { GrowthChart } from "@/components/charts/GrowthChart";
import { MixBar } from "@/components/charts/MixBar";
import { TrendChart } from "@/components/charts/TrendChart";
import { InsightPanel } from "@/components/InsightPanel";
import { NewVideosPanel, SuperfansPanel, TopicTrendsPanel } from "@/components/FeaturePanels";
import { commenters, predictions, topicTrends } from "@/lib/features";
import { RangeTabs, rangeSince } from "@/components/RangeTabs";
import { Reveal } from "@/components/Reveal";
import { Empty, Panel, Stat, Tag } from "@/components/ui";
import { compact, date, duration, score } from "@/lib/format";
import {
  aspectCounts, channel as getChannel, channelSnapshots, dailySentiment, emotionCounts, languageCounts,
  latestInsight, sentimentMix, videos as getVideos,
} from "@/lib/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await getChannel((await params).id);
  return { title: c?.title ?? "Channel" };
}

export default async function ChannelPage({ params, searchParams }:
  { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> }) {
  const { id } = await params;
  const { key, since } = rangeSince((await searchParams).range);
  const c = await getChannel(id);
  if (!c) notFound();
  const f = { channelId: id, since };
  const [insight, mix, daily, langs, emos, aspects, snaps, vids] = await Promise.all([
    latestInsight("channel", id), sentimentMix(f), dailySentiment(f), languageCounts(f), emotionCounts(f),
    aspectCounts(f), channelSnapshots(id), getVideos(id),
  ]);
  const [people, trend, preds] = await Promise.all([commenters(id), topicTrends(id), predictions(id)]);

  return (
    <>
      <Reveal>
        <div className="panel relative mb-6 overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute -left-20 -top-28 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            {c.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.thumbnail_url} alt="" className="h-20 w-20 rounded-2xl object-cover ring-2 ring-white/10" />
            ) : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-accent/30 to-accent-2/30 text-2xl font-semibold">{c.title.slice(0, 1)}</div>}
            <div className="min-w-0 flex-1">
              <div className="label">Channel</div>
              <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">{c.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a href={`https://www.youtube.com/channel/${c.id}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-accent">{c.handle ?? c.id}<ExternalLink size={13} /></a>
                {!c.active && <Tag tone="warn">paused</Tag>}
                <Link href={`/analytics?c=${encodeURIComponent(c.id)}`} className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-accent/50 hover:text-ink">Analytics</Link>
                <Link href={`/report/${encodeURIComponent(c.id)}`} className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-accent/50 hover:text-ink">Weekly report / PDF</Link>
              </div>
            </div>
            <div className="w-full sm:w-72"><MixBar mix={mix} /></div>
          </div>
        </div>
      </Reveal>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Reveal><Stat label="Subscribers" value={c.subscriber_count ?? 0} accent /></Reveal>
        <Reveal delay={0.05}><Stat label="Total views" value={c.view_count ?? 0} /></Reveal>
        <Reveal delay={0.1}><Stat label="Comments captured" value={c.comments} hint={`${c.videos_backfilled}/${c.videos_stored} videos complete`} /></Reveal>
        <Reveal delay={0.15}><Stat label="Sentiment score" value={Math.round((c.avg_sentiment ?? 0) * 100)} format="signed" hint="−100 … +100" /></Reveal>
      </div>

      <Reveal delay={0.1} className="mt-6"><InsightPanel insight={insight} scope="channel" /></Reveal>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">Audience signals</h2>
        <RangeTabs current={key} basePath={`/channels/${id}`} />
      </div>

      <div className="mt-3 grid gap-4 xl:grid-cols-3">
        <Reveal className="xl:col-span-2">
          <Panel title="Conversation volume" subtitle="Comments per period, split by sentiment">
            {daily.length ? <TrendChart data={daily} /> : <Empty>No comments in this range.</Empty>}
          </Panel>
        </Reveal>
        <Reveal delay={0.05}>
          <Panel title="Languages" subtitle="What viewers write in">
            <BarList rows={langs.map((l) => ({ label: l.name, value: l.comments }))} empty="Appears after analysis." />
          </Panel>
        </Reveal>
        <Reveal delay={0.1} className="xl:col-span-2">
          <Panel title="Praise vs criticism" subtitle="What comments talk about, from the AI read">
            {aspects.length ? <AspectChart data={aspects} /> : <Empty>Appears after the AI has read comments.</Empty>}
          </Panel>
        </Reveal>
        <Reveal delay={0.15}>
          <Panel title="Emotions" subtitle="Excluding neutral">
            <BarList color="#8b7cf6" rows={emos.filter((e) => e.emotion !== "neutral").map((e) => ({ label: `${e.icon} ${e.emotion}`, value: e.comments }))}
              empty="Appears after the AI has read comments." />
          </Panel>
        </Reveal>
      </div>

      {preds.length > 0 && <Reveal delay={0.1} className="mt-4"><NewVideosPanel preds={preds} /></Reveal>}
      <Reveal delay={0.1} className="mt-4"><TopicTrendsPanel trend={trend} /></Reveal>
      <Reveal delay={0.1} className="mt-4"><SuperfansPanel superfans={people.superfans} critics={people.critics} /></Reveal>

      {snaps.length > 1 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Panel title="Subscribers" subtitle="Since tracking started"><GrowthChart data={snaps} dataKey="subscribers" name="Subscribers" /></Panel>
          <Panel title="Total views" subtitle="Since tracking started"><GrowthChart data={snaps} dataKey="views" name="Views" /></Panel>
        </div>
      )}

      <Reveal delay={0.1} className="mt-6">
        <Panel title="Videos" subtitle={`${vids.length} videos · newest first`}>
          {vids.length === 0 ? <Empty>Videos appear after the next sync run.</Empty> : (
            <div className="scrollbar-thin -mx-2 overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-y-1 text-[13.5px]">
                <thead>
                  <tr className="text-left">
                    {["Video", "Published", "Views", "Comments", "Sentiment", "Mix"].map((h) => <th key={h} className="label px-2 py-2 font-normal">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {vids.map((v) => (
                    <tr key={v.id} className="group">
                      <td className="rounded-l-xl bg-white/[0.02] px-2 py-2 group-hover:bg-white/[0.05]">
                        <Link href={`/videos/${v.id}`} className="flex items-center gap-3">
                          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-white/5">
                            {v.thumbnail_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
                            )}
                            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 font-mono text-[10px]">{duration(v.duration)}</span>
                            <Play size={16} className="absolute inset-0 m-auto text-white opacity-0 transition group-hover:opacity-100" />
                          </div>
                          <span className="line-clamp-2 text-ink group-hover:text-accent">{v.title}</span>
                        </Link>
                      </td>
                      <td className="bg-white/[0.02] px-2 text-ink-2 group-hover:bg-white/[0.05]">{date(v.published_at)}</td>
                      <td className="bg-white/[0.02] px-2 tabular group-hover:bg-white/[0.05]">{compact(v.view_count)}</td>
                      <td className="bg-white/[0.02] px-2 tabular group-hover:bg-white/[0.05]">
                        {v.comments_disabled ? <span className="text-ink-3">off</span> : <>{compact(v.comments_stored)}{!v.comments_backfilled && <span className="ml-1.5 text-[11px] text-warn">↓</span>}</>}
                      </td>
                      <td className="bg-white/[0.02] px-2 tabular group-hover:bg-white/[0.05]">{score(v.avg_sentiment)}</td>
                      <td className="w-40 rounded-r-xl bg-white/[0.02] px-2 group-hover:bg-white/[0.05]"><MixBar mix={v} size="sm" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </Reveal>
    </>
  );
}
