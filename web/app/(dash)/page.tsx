import { ArrowUpRight, Sparkles } from "lucide-react";
import { cached, within } from "@/lib/cache";
import Link from "next/link";
import { MixBar } from "@/components/charts/MixBar";
import { TrendChart } from "@/components/charts/TrendChart";
import { RangeTabs, rangeSince } from "@/components/RangeTabs";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { ago, compact, score } from "@/lib/format";
import { LiveFeed } from "@/components/LiveFeed";
import { AlertsPanel, NewVideosPanel } from "@/components/FeaturePanels";
import { recentAlerts } from "@/lib/alerts";
import { predictions } from "@/lib/features";
import { channels as getChannels, comments, dailySentiment, kpis, progress, recentInsights } from "@/lib/queries";
import { ProgressPanel } from "@/components/ProgressPanel";
import { LiveNowBanner } from "@/components/LiveChatPanel";
import { liveNow } from "@/lib/livechat";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const { key, since } = rangeSince(range);
  const [k, chs, daily, briefs, latest] = await Promise.all([
    within(kpis(), 10_000, { channels: 0, videos: 0, comments: 0, analyzed: 0, ai_read: 0, videos_backfilling: 0, last_fetch: null,
      quota_used_today: 0, comments_24h: 0 }), within(getChannels(), 10_000, []), within(cached(`overview:daily:${key}`, Number(process.env.PAGE_CACHE_SECONDS ?? 600) * 1000, () => dailySentiment({ since })), 12_000, []),
    within(recentInsights(4), 8000, []), within(comments({ hideSpam: true }, "newest", 8), 8000, []),
  ]);
  const prog = await within(progress(), 15000, []);
  const [alertList, preds, live] = await Promise.all([within(recentAlerts(8), 8000, []), within(predictions(), 10000, []), within(liveNow(), 8000, [])]);
  const historyBusy = prog.some((p) => p.comments_stored < p.comments_on_youtube * 0.98 || p.ai_read < p.comments_stored * 0.98
    || (p.videos_total ?? 0) > p.videos_known);
  const analysed = chs.reduce((s, c) => s + c.positive + c.neutral + c.negative, 0);
  const weighted = analysed ? chs.reduce((s, c) => s + (c.avg_sentiment ?? 0) * (c.positive + c.neutral + c.negative), 0) / analysed : 0;

  return (
    <>
      <LiveNowBanner live={live} />
      <PageHeader eyebrow="Mission control" title={<>Audience <span className="glow-text">pulse</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">
          {k.channels} channel{k.channels === 1 ? "" : "s"} under watch · {compact(k.comments)} comments captured ·{" "}
          {compact(k.comments_24h)} in the last 24 hours.
        </p>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Reveal><Stat label="Comments captured" value={k.comments} accent hint={`+${compact(k.comments_24h)} in 24h`} /></Reveal>
        <Reveal delay={0.05}><Stat label="Sentiment score" value={Math.round(weighted * 100)} format="signed" hint="−100 … +100, all channels" /></Reveal>
        <Reveal delay={0.1}><Stat label="Read by AI" value={k.comments ? Math.round((k.ai_read / k.comments) * 100) : 0} suffix="%" hint={`${compact(k.ai_read)} deep-read comments`} /></Reveal>
        <Reveal delay={0.15}><Stat label="Videos tracked" value={k.videos} hint={k.videos_backfilling ? `${k.videos_backfilling} still downloading history` : "history complete"} /></Reveal>
      </div>

      {historyBusy && <Reveal delay={0.1} className="mt-6"><ProgressPanel rows={prog} /></Reveal>}

      {chs.length === 0 ? (
        <div className="mt-8"><Empty>No channels yet. Add creators on the <Link href="/manage" className="text-accent">Manage</Link> page.</Empty></div>
      ) : (
        <>
          <Reveal delay={0.1} className="mt-8">
            <div className="mb-3 flex items-end justify-between">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">Channels</h2>
              <span className="label">{chs.length} watching</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {chs.map((c) => (
                <Link key={c.id} href={`/channels/${c.id}`} className="panel panel-hover group block p-5">
                  <div className="flex items-center gap-3">
                    {c.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail_url} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-white/10" />
                    ) : <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-accent/30 to-accent-2/30 font-semibold">{c.title.slice(0, 1)}</div>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{c.title}</div>
                      <div className="truncate text-[12.5px] text-ink-3">{c.handle ?? c.id} · {compact(c.subscriber_count)} {c.id.startsWith("ig_") ? "followers" : "subs"}</div>
                    </div>
                    <ArrowUpRight size={18} className="text-ink-3 transition group-hover:text-accent" />
                  </div>
                  <div className="mt-5 flex items-end justify-between">
                    <div>
                      <div className="label">Sentiment</div>
                      <div className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular">{score(c.avg_sentiment)}</div>
                    </div>
                    <div className="text-right">
                      <div className="label">Comments</div>
                      <div className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular">{compact(c.comments)}</div>
                    </div>
                  </div>
                  <div className="mt-4"><MixBar mix={c} size="sm" /></div>
                  {!c.active && <div className="mt-3 text-[12px] text-warn">Paused</div>}
                </Link>
              ))}
            </div>
          </Reveal>

          <div className="mt-8 grid gap-4 xl:grid-cols-3">
            <Reveal delay={0.15} className="xl:col-span-2">
              <Panel title="Conversation volume" subtitle="Comments by the day they were posted, split by sentiment" action={<RangeTabs current={key} basePath="/" />}>
                {daily.length ? <TrendChart data={daily} /> : <Empty>No comments in this range.</Empty>}
              </Panel>
            </Reveal>
            <Reveal delay={0.2}>
              <Panel title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-accent" />Latest AI briefings</span>}>
                {briefs.length === 0 ? <Empty>Briefings appear once the AI has read enough comments.</Empty> : (
                  <ul className="space-y-3">
                    {briefs.map((b) => (
                      <li key={`${b.scope}-${b.id}-${b.created_at}`}>
                        <Link href={b.scope === "video" ? `/videos/${b.id}` : `/channels/${b.id}`} className="block rounded-xl border border-line bg-white/[0.02] p-3.5 transition hover:border-accent/40">
                          <div className="flex items-center gap-2 text-[12px] text-ink-3"><span className="label">{b.scope}</span>{ago(b.created_at)}</div>
                          <div className="mt-1 line-clamp-1 text-[13.5px] font-medium text-ink">{b.title}</div>
                          <p className="mt-1 line-clamp-3 text-[13px] text-ink-2">{b.summary}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </Reveal>
          </div>

          {preds.length > 0 && <Reveal delay={0.2} className="mt-4"><NewVideosPanel preds={preds} /></Reveal>}

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Reveal delay={0.25} className="xl:col-span-2">
              <Panel title={<span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent animate-[pulse-dot_2s_ease-out_infinite]" />Live feed</span>}
                subtitle="Newest comments across your channels; new ones slide in automatically"
                action={<Link href="/comments" className="text-[13px] text-ink-3 hover:text-accent">All comments →</Link>}>
                {latest.length ? <LiveFeed comments={latest} /> : <Empty>Comments appear here as they arrive.</Empty>}
              </Panel>
            </Reveal>
            <Reveal delay={0.3}><AlertsPanel alerts={alertList} /></Reveal>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            {chs.length > 0 && (
              <Reveal delay={0.3} className="xl:col-span-3">
                <Panel title="Sentiment mix by channel" subtitle="Share of analysed comments">
                  <div className="space-y-5">
                    {chs.filter((c) => c.positive + c.neutral + c.negative > 0).map((c) => (
                      <div key={c.id}>
                        <Link href={`/channels/${c.id}`} className="mb-2 block truncate text-[13.5px] text-ink-2 hover:text-accent">{c.title}</Link>
                        <MixBar mix={c} />
                      </div>
                    ))}
                  </div>
                </Panel>
              </Reveal>
            )}
          </div>
        </>
      )}
    </>
  );
}
