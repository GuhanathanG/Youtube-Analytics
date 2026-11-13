import { ArrowUpRight, Sparkles } from "lucide-react";
import { within } from "@/lib/cache";
import { overviewDaily, panel } from "@/lib/panels";
import { focusChannel } from "@/lib/focus";
import { summaries } from "@/lib/summary";
import Link from "next/link";
import { MixBar } from "@/components/charts/MixBar";
import { TrendChart } from "@/components/charts/lazy";
import { RangeTabs, rangeSince } from "@/components/RangeTabs";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { C, HeroStage, KpiOrb, MoodGlyph, PulseRing } from "@/components/viz";
import { channelHealth } from "@/lib/creator-insights";
import { nextMoves } from "@/lib/recommendations";
import { stored } from "@/lib/stored";
import { ago, compact, score } from "@/lib/format";
import { LiveFeed } from "@/components/LiveFeed";
import { AlertsPanel, NewVideosPanel } from "@/components/FeaturePanels";
import { recentAlerts } from "@/lib/alerts";
import { predictions } from "@/lib/features";
import { channels as getChannels, comments, kpis, progress, recentInsights } from "@/lib/queries";
import { ProgressPanel } from "@/components/ProgressPanel";
import { LiveNowBanner } from "@/components/LiveChatPanel";
import { liveNow } from "@/lib/livechat";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const { key } = rangeSince(range);
  const allChs = await within(getChannels(), 10_000, []);
  // Channel focus (top bar): everything below is about that one channel unless "All channels" is chosen.
  const focus = await focusChannel(allChs.filter((c) => c.active).map((c) => c.id));
  const chs = focus ? allChs.filter((c) => c.id === focus) : allChs;
  // Everything below loads at once (it used to wait in three rounds).
  const [sums, kAll, daily, briefs, latest, progAll, alertList, preds, live] = await Promise.all([
    within(summaries(), 8000, new Map()),
    within(kpis(), 10_000, { channels: 0, videos: 0, comments: 0, analyzed: 0, ai_read: 0, videos_backfilling: 0, last_fetch: null,
      quota_used_today: 0, comments_24h: 0 }),
    within(focus ? panel("daily", focus, key) : overviewDaily(key), 12_000, []),
    within(recentInsights(4, focus), 8000, []), within(comments({ hideSpam: true, channelId: focus }, "newest", 8), 8000, []),
    within(progress(), 15000, []), within(recentAlerts(8, focus), 8000, []), within(predictions(focus ?? undefined), 10000, []),
    within(liveNow(), 8000, []),
  ]);
  // Hero: the focused channel's health and today's #1 move ("next moves" is heavy, so it's saved for 30 minutes).
  const heroId = focus ?? allChs.find((c) => c.active && c.role !== "competitor")?.id ?? null;
  const [health, top] = heroId ? await Promise.all([
    within(channelHealth(heroId), 4000, null),
    within(stored(`moves:${heroId}`, 30 * 60_000, () => nextMoves(heroId)), 4000, null),
  ]) : [null, null];
  const heroCh = heroId ? allChs.find((c) => c.id === heroId) : null;
  const one = focus ? sums.get(focus) : null;
  const fc = focus ? allChs.find((c) => c.id === focus) : null;
  const k = one && fc ? { ...kAll, channels: 1, comments: one.comments, analyzed: one.analyzed, ai_read: one.ai_read, comments_24h: one.comments_24h,
    videos: fc.videos_stored, videos_backfilling: Math.max(0, fc.videos_stored - fc.videos_backfilled) } : kAll;
  const prog = progAll.filter((p) => !focus || p.channel_id === focus);
  const historyBusy = prog.some((p) => p.comments_stored < p.comments_on_youtube * 0.98 || p.ai_read < p.comments_stored * 0.98
    || (p.videos_total ?? 0) > p.videos_known);
  const analysed = chs.reduce((s, c) => s + c.positive + c.neutral + c.negative, 0);
  const weighted = analysed ? chs.reduce((s, c) => s + (c.avg_sentiment ?? 0) * (c.positive + c.neutral + c.negative), 0) / analysed : 0;
  // Shapes for the numbers: comments per period and net mood per period, from the same series as the chart below.
  // The last period is still running (partial), so it's left out: it would always look like a drop.
  const done = daily.length >= 3 ? daily.slice(0, -1) : daily;
  const volTrend = done.map((d) => d.positive + d.neutral + d.negative + d.pending);
  const moodTrend = done.filter((d) => d.positive + d.neutral + d.negative > 0)
    .map((d) => Math.round(((d.positive - d.negative) / (d.positive + d.neutral + d.negative)) * 100));
  const moodDelta = moodTrend.length >= 2 ? moodTrend[moodTrend.length - 1] - moodTrend[moodTrend.length - 2] : null;

  return (
    <>
      <LiveNowBanner live={live} />
      <PageHeader eyebrow="Mission control" title={<>Audience <span className="glow-text">pulse</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">
          {fc ? <>{fc.title} · </> : <>{k.channels} channel{k.channels === 1 ? "" : "s"} under watch · </>}{compact(k.comments)} comments captured ·{" "}
          {compact(k.comments_24h)} in the last 24 hours.
        </p>
      </PageHeader>

      {heroCh && (
        <Reveal className="mb-4"><HeroStage>
          <div className="grid items-center gap-6 md:grid-cols-[auto_1fr_auto]">
            <div className="flex justify-center"><PulseRing value={health?.score ?? 0} label="Health" sub={health?.grade ?? "measuring"} size={176}
              color={(health?.score ?? 0) >= 70 ? C.good : (health?.score ?? 0) >= 45 ? C.accent : C.gold} trend={moodTrend.length >= 2 ? moodTrend : undefined} /></div>
            <div className="min-w-0">
              <div className="label" style={{ color: C.ai }}>✦ Today&apos;s #1 move · {heroCh.title}</div>
              <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
                {top?.moves[0]?.title ?? (briefs[0] ? "Your audience, at a glance" : "All clear for now")}</h2>
              <p className="mt-2 max-w-2xl text-[14px] text-ink-2">{top?.moves[0]?.why ?? briefs[0]?.summary ?? "Nothing urgent. New comments and uploads update this live."}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {top?.moves[0] && <Link href={top.moves[0].href} className="btn-neon rounded-xl px-4 py-2 text-[13.5px] font-medium">{top.moves[0].cta} →</Link>}
                <Link href="/command" className="rounded-xl border border-line-2 px-4 py-2 text-[13.5px] text-ink-2 hover:border-accent/50 hover:text-ink">
                  {top?.moves.length ? `All ${top.moves.length} moves` : "Next moves"}</Link>
              </div>
            </div>
            <div className="hidden flex-col items-center gap-2 md:flex">
              <MoodGlyph positive={heroCh.positive} neutral={heroCh.neutral} negative={heroCh.negative} size={120} />
              <span className="label">Audience mood</span>
            </div>
          </div>
        </HeroStage></Reveal>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Reveal><KpiOrb focal label="Comments captured" value={k.comments} hint={`+${compact(k.comments_24h)} in 24h`} trend={volTrend} /></Reveal>
        <Reveal delay={0.05}><KpiOrb label="Sentiment score" value={Math.round(weighted * 100)} format="signed" color={C.pos} trend={moodTrend}
          delta={moodDelta} deltaSuffix=" pts" hint={focus ? "−100 … +100, this channel" : "−100 … +100, all channels"} /></Reveal>
        <Reveal delay={0.1}><KpiOrb label="Read by AI" value={k.comments ? Math.round((k.ai_read / k.comments) * 100) : 0} suffix="%" color={C.ai}
          hint={`${compact(k.ai_read)} deep-read comments`} /></Reveal>
        <Reveal delay={0.15}><KpiOrb label="Videos tracked" value={k.videos} color={C.gold}
          hint={k.videos_backfilling ? `${k.videos_backfilling} still downloading history` : "history complete"} /></Reveal>
      </div>

      {historyBusy && <Reveal delay={0.1} className="mt-6"><ProgressPanel rows={prog} /></Reveal>}

      {chs.length === 0 ? (
        <div className="mt-8"><Empty>No channels yet. Add creators on the <Link href="/manage" className="text-accent">Manage</Link> page.</Empty></div>
      ) : (
        <>
          <Reveal delay={0.1} className="mt-8">
            <div className="mb-3 flex items-end justify-between">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">Channels</h2>
              <span className="label">{allChs.length} watching</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {allChs.map((c) => (
                <Link key={c.id} href={`/channels/${c.id}`} className={`panel panel-hover group block p-5 ${c.id === focus ? "ring-1 ring-accent/50" : ""}`}>
                  <div className="flex items-center gap-3">
                    {c.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img decoding="async" src={c.thumbnail_url} alt="" className="h-11 w-11 rounded-full object-cover ring-2 ring-white/10" />
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
                subtitle={focus ? "Newest comments on this channel" : "Newest comments across your channels; new ones slide in automatically"}
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
