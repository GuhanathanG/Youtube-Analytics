import Link from "next/link";
import { within } from "@/lib/cache";
import { overviewDaily, panel } from "@/lib/panels";
import { focusChannel } from "@/lib/focus";
import { summaries } from "@/lib/summary";
import { rangeSince, RangeTabs } from "@/components/RangeTabs";
import { Empty, Panel } from "@/components/ui";
import { channelHealth } from "@/lib/creator-insights";
import { movesFor } from "@/lib/recommendations";
import { ago, compact } from "@/lib/format";
import { LiveFeed } from "@/components/LiveFeed";
import { AlertsPanel, NewVideosPanel } from "@/components/FeaturePanels";
import { recentAlerts } from "@/lib/alerts";
import { predictions } from "@/lib/features";
import { channels as getChannels, comments, kpis, progress, recentInsights, type DailyRow } from "@/lib/queries";
import { ProgressPanel } from "@/components/ProgressPanel";
import { LiveNowBanner } from "@/components/LiveChatPanel";
import { liveNow } from "@/lib/livechat";
import { InView, Words } from "@/components/signal/InView";
import { Decode } from "@/components/signal/Decode";
import { PulseOrb } from "@/components/signal/PulseOrb";
import { Waveform } from "@/components/signal/Waveform";
import { TickRing } from "@/components/signal/TickRing";
import { MiniLine } from "@/components/signal/Bits";
import { Pill, SigHead } from "@/components/signal/Head";

export const metadata = { title: "Overview" };

const OF = 6;
const moodColor = (s: string | null) => (s === "positive" ? "var(--cyan)" : s === "negative" ? "var(--magenta)" : "var(--neutral)");

/** Long ranges become weekly bars, so the waveform stays readable. */
const fmtDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function weekly(days: DailyRow[]): DailyRow[] {
  if (days.length <= 180) return days;
  const out = new Map<string, DailyRow>();
  for (const d of days) {
    const t = new Date(d.day + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    const k = t.toISOString().slice(0, 10);
    const w = out.get(k) ?? { day: k, positive: 0, neutral: 0, negative: 0, pending: 0 };
    w.positive += d.positive; w.neutral += d.neutral; w.negative += d.negative; w.pending += d.pending;
    out.set(k, w);
  }
  return [...out.values()];
}

export default async function Overview({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const { key } = rangeSince(range);
  const allChs = await within(getChannels(), 10_000, []);
  // Channel focus (top bar): everything below is about that one channel unless "All channels" is chosen.
  const focus = await focusChannel(allChs.filter((c) => c.active).map((c) => c.id));
  const chs = focus ? allChs.filter((c) => c.id === focus) : allChs;
  const [sums, kAll, daily, briefs, latest, progAll, alertList, preds, live] = await Promise.all([
    within(summaries(), 8000, new Map()),
    within(kpis(), 10_000, { channels: 0, videos: 0, comments: 0, analyzed: 0, ai_read: 0, videos_backfilling: 0, last_fetch: null,
      quota_used_today: 0, comments_24h: 0 }),
    within(focus ? panel("daily", focus, key) : overviewDaily(key), 12_000, []),
    within(recentInsights(4, focus), 8000, []), within(comments({ hideSpam: true, channelId: focus }, "newest", 12), 8000, []),
    within(progress(), 15000, []), within(recentAlerts(8, focus), 8000, []), within(predictions(focus ?? undefined), 10000, []),
    within(liveNow(), 8000, []),
  ]);
  // Hero: the focused channel's health and today's #1 move ("next moves" is heavy, so it's saved for 30 minutes).
  const heroId = focus ?? allChs.find((c) => c.active && c.role !== "competitor")?.id ?? null;
  const [health, top] = heroId ? await Promise.all([
    within(channelHealth(heroId), 4000, null),
    within(movesFor(heroId), 4000, null),
  ]) : [null, null];
  const heroCh = heroId ? allChs.find((c) => c.id === heroId) : null;
  const one = focus ? sums.get(focus) : null;
  const fc = focus ? allChs.find((c) => c.id === focus) : null;
  const k = one && fc ? { ...kAll, channels: 1, comments: one.comments, analyzed: one.analyzed, ai_read: one.ai_read, comments_24h: one.comments_24h,
    videos: fc.videos_stored, videos_backfilling: Math.max(0, fc.videos_stored - fc.videos_backfilled) } : kAll;
  const prog = progAll.filter((p) => !focus || p.channel_id === focus);
  // Work really waiting (not "YouTube's total is bigger": the archive holds older comments, competitors skip comments).
  const historyBusy = prog.some((p) => (p.role !== "competitor" && (p.history_left ?? 0) > 0) || (p.ai_waiting ?? 0) > 200
    || (p.videos_total ?? 0) > p.videos_known + Math.max(5, (p.videos_total ?? 0) * 0.01));
  const analysed = chs.reduce((s, c) => s + c.positive + c.neutral + c.negative, 0);
  const weighted = analysed ? chs.reduce((s, c) => s + (c.avg_sentiment ?? 0) * (c.positive + c.neutral + c.negative), 0) / analysed : 0;
  // Shapes for the numbers: comments per period and net mood per period, from the same series as the chart below.
  // The last period is still running (partial), so it's left out: it would always look like a drop.
  const done = daily.length >= 3 ? daily.slice(0, -1) : daily;
  const volTrend = done.map((d) => d.positive + d.neutral + d.negative + d.pending);
  const moodTrend = done.filter((d) => d.positive + d.neutral + d.negative > 0)
    .map((d) => Math.round(((d.positive - d.negative) / (d.positive + d.neutral + d.negative)) * 100));
  const moodDelta = moodTrend.length >= 2 ? moodTrend[moodTrend.length - 1] - moodTrend[moodTrend.length - 2] : null;
  const active = allChs.filter((c) => c.active);
  const maxC = Math.max(1, ...active.map((c) => c.comments));
  const sats = active.map((c) => ({ id: c.id, title: c.title, thumb: c.thumbnail_url, weight: Math.sqrt(c.comments / maxC), mood: c.avg_sentiment ?? 0 }));
  const move = top?.moves[0];
  const scope = fc ? fc.title : `${k.channels} channel${k.channels === 1 ? "" : "s"}`;
  const kpi = [
    { i: "0001", label: "Comments captured", value: k.comments, f: "int" as const, note: `+${k.comments_24h.toLocaleString("en")} in 24 h`, line: volTrend, color: "#ededea", lc: "#22e1ff" },
    { i: "0010", label: "Audience mood", value: Math.round(weighted * 100), f: "signed" as const,
      note: moodDelta === null ? "−100 … +100" : `${moodDelta >= 0 ? "▲" : "▼"} ${Math.abs(moodDelta)} pts vs previous period`, line: moodTrend, color: "#22e1ff", lc: "#22e1ff" },
    { i: "0011", label: "Read by AI", value: k.comments ? (k.ai_read / k.comments) * 100 : 0, f: "pct" as const, note: `${compact(k.ai_read)} deep-read comments`, line: [], color: "#ff3d7f", lc: "#ff3d7f" },
    { i: "0100", label: "Videos tracked", value: k.videos, f: "int" as const,
      note: k.videos_backfilling ? `${k.videos_backfilling} still downloading history` : "history complete", line: [], color: "#ededea", lc: "#ededea" },
  ];

  return (
    <div className="sig">
      <LiveNowBanner live={live} />

      {/* 01 · Pulse */}
      <InView as="section" className="sec grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] lg:gap-16">
        <div className="min-w-0" style={{ containerType: "inline-size" }}>
          <div className="mono rise" style={{ color: "var(--cyan)" }}>■ 01 / {String(OF).padStart(2, "0")} · Audience pulse</div>
          <h1 className="display mt-5" style={{ fontSize: "min(13cqw, 92px)" }}>
            <Decode value={k.comments} className="block" /><Words text="voices." />
          </h1>
          <p className="rise lede mt-7" style={{ transitionDelay: "300ms", maxWidth: "48ch" }}>
            Every comment across {scope}, read and scored. {k.comments_24h.toLocaleString("en")} arrived in the last 24 hours. The core beats faster when they do.
          </p>
          <div className="rise mt-8 flex flex-wrap gap-3" style={{ transitionDelay: "450ms" }}>
            <Pill href="#move" solid>Today&apos;s move</Pill>
            <Pill href="/comments">All comments</Pill>
          </div>
        </div>
        <div className="rise min-w-0" style={{ transitionDelay: "200ms" }}><PulseOrb perDay={k.comments_24h} satellites={sats} size={500} /></div>
      </InView>

      {/* Live ticker: the newest comments (this channel only when one is chosen). */}
      {latest.length > 0 && (
        <div className="ticker -mx-4 border-y py-3.5 sm:-mx-8" style={{ borderColor: "var(--hair)" }}>
          <div className="ticker-track">
            {[0, 1].map((rep) => (
              <div key={rep} className="flex shrink-0" aria-hidden={rep === 1}>
                {latest.map((c) => (
                  <span key={c.id} className="flex shrink-0 items-center gap-3 px-6 text-[13px]" style={{ color: "var(--ink-2)" }}>
                    <span className="sq" style={{ color: moodColor(c.sentiment) }} />
                    <span className="mono" style={{ fontSize: 9.5 }}>{c.channel_title}</span>
                    <span className="max-w-[360px] truncate">{c.translation || c.text}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {historyBusy && <div className="mt-10"><ProgressPanel rows={prog} /></div>}

      {/* 02 · Today's move */}
      <InView as="section" id="move" className="sec scroll-mt-28">
        <SigHead n={2} of={OF} label="Next move" title="One thing worth doing today."
          action={<Pill href="/command">All {top?.moves.length ?? 0} moves →</Pill>} />
        <div className="cell grid items-center gap-10 p-7 md:grid-cols-[auto_1fr] md:gap-14 md:p-10">
          <div className="flex justify-center"><TickRing value={health?.score ?? 0} label="Health" sub={health?.grade ?? "measuring"} size={188}
            color={(health?.score ?? 0) >= 70 ? "#22e1ff" : (health?.score ?? 0) >= 45 ? "#ededea" : "#ff3d7f"} /></div>
          <div className="min-w-0">
            <div className="mono rise" style={{ color: "var(--magenta)" }}>✦ {heroCh?.title ?? "Your channel"}{move ? <> · impact {"■".repeat(move.impact)}{"□".repeat(3 - move.impact)}</> : null}</div>
            <h3 className="display mt-4 text-[26px] md:text-[34px]"><Words text={move?.title ?? (briefs[0] ? "Your audience, at a glance" : "All clear for now")} /></h3>
            <p className="rise lede mt-4" style={{ transitionDelay: "300ms" }}>{move?.why ?? briefs[0]?.summary ?? "Nothing urgent. New comments and uploads update this live."}</p>
            <div className="rise mt-7 flex flex-wrap gap-3" style={{ transitionDelay: "450ms" }}>
              {move && <Pill href={move.href} solid>{move.cta}</Pill>}
              {heroCh && (
                <span className="flex items-center gap-3 pl-1">
                  <span className="bar w-36" aria-label="Audience mood">
                    <span style={{ width: `${(heroCh.positive / Math.max(1, heroCh.positive + heroCh.neutral + heroCh.negative)) * 100}%`, background: "var(--cyan)" }} />
                    <span style={{ width: `${(heroCh.neutral / Math.max(1, heroCh.positive + heroCh.neutral + heroCh.negative)) * 100}%`, background: "var(--neutral)" }} />
                    <span style={{ width: `${(heroCh.negative / Math.max(1, heroCh.positive + heroCh.neutral + heroCh.negative)) * 100}%`, background: "var(--magenta)" }} />
                  </span>
                  <span className="mono" style={{ fontSize: 10 }}>Audience mood</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </InView>

      {/* 03 · Numbers */}
      <InView as="section" className="sec">
        <SigHead n={3} of={OF} label="Numbers" title="The audience, in four numbers.">
          Each number decodes, then counts up to its live value. Lines show the selected period.
        </SigHead>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {kpi.map((x, i) => (
            <div key={x.label} className="cell cell-hover min-w-0 p-6 md:p-7" style={{ containerType: "inline-size" }}>
              <div className="mono flex justify-between gap-3" style={{ fontSize: 10 }}><span style={{ color: "var(--cyan)" }}>{x.i}</span><span className="truncate">{x.label}</span></div>
              <div className="display mt-6 whitespace-nowrap md:mt-8" style={{ color: x.color, fontSize: "min(42px, 12.5cqw)" }}><Decode value={x.value} format={x.f} delay={i * 120} /></div>
              <div className="mt-2 text-[13.5px]" style={{ color: "var(--ink-3)" }}>{x.note}</div>
              <div className="mt-6"><MiniLine values={x.line} color={x.lc} delay={500 + i * 120} signed={x.f === "signed"}
                from={x.line.length > 1 && done[0] ? `${fmtDay(done[0].day)}` : undefined} to={x.line.length > 1 && done.length ? `${fmtDay(done[done.length - 1].day)} · per ${daily.length > 180 ? "week" : "day"}` : undefined} /></div>
            </div>
          ))}
        </div>
      </InView>

      {chs.length === 0 ? (
        <div className="mt-8"><Empty>No channels yet. Add creators on the <Link href="/manage" className="text-accent">Manage</Link> page.</Empty></div>
      ) : (
        <>
          {/* 04 · Conversation */}
          <InView as="section" className="sec">
            <SigHead n={4} of={OF} label="Conversation volume" title="The conversation, day by day."
              action={<RangeTabs current={key} basePath="/" />}>
              Comments by the day they were posted (by week for long ranges), stacked by mood. Hover any column for exact counts; drag the slider under the chart to pick a period, or switch to area or lines.
            </SigHead>
            <div className="cell p-5 md:p-8">{daily.length ? <Waveform days={weekly(daily)} /> : <Empty>No comments in this range.</Empty>}</div>
            <div className="mt-10 grid gap-x-14 gap-y-7 md:grid-cols-2">
              {chs.filter((c) => c.positive + c.neutral + c.negative > 0).map((c) => {
                const n = c.positive + c.neutral + c.negative;
                return (
                  <div key={c.id}>
                    <div className="mb-2.5 flex items-baseline justify-between gap-3">
                      <Link href={`/channels/${c.id}`} className="truncate text-[15px] hover:text-[var(--cyan)]">{c.title}</Link>
                      <span className="mono shrink-0" style={{ fontSize: 10 }}><span style={{ color: "var(--cyan)" }}>{Math.round((c.positive / n) * 100)}%</span> / <span style={{ color: "var(--magenta)" }}>{Math.round((c.negative / n) * 100)}%</span></span>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${(c.positive / n) * 100}%`, background: "var(--cyan)" }} />
                      <span style={{ width: `${(c.neutral / n) * 100}%`, background: "var(--neutral)", transitionDelay: "150ms" }} />
                      <span style={{ width: `${(c.negative / n) * 100}%`, background: "var(--magenta)", transitionDelay: "300ms" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </InView>

          {/* 05 · Channels */}
          <InView as="section" className="sec">
            <SigHead n={5} of={OF} label="Channels" title={`${allChs.length} channels under watch.`} />
            <div className="grid sm:grid-cols-2 xl:grid-cols-3">
              {allChs.map((c, i) => {
                const n = c.positive + c.neutral + c.negative;
                return (
                  <Link key={c.id} href={`/channels/${c.id}`} className={`cell cell-hover group block p-6 ${c.id === focus ? "!bg-[rgba(34,225,255,.04)]" : ""}`} style={{ transitionDelay: `${i * 60}ms` }}>
                    <div className="flex items-center gap-3">
                      {c.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img decoding="async" src={c.thumbnail_url} alt="" className="h-11 w-11 rounded-full object-cover ring-1 ring-white/15" />
                      ) : <div className="grid h-11 w-11 place-items-center rounded-full bg-white/10 font-semibold">{c.title.slice(0, 1)}</div>}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{c.title}</div>
                        <div className="mono mt-0.5 truncate" style={{ fontSize: 9.5 }}>{c.id.startsWith("ig_") ? "Instagram" : "YouTube"} / {compact(c.subscriber_count)} {c.id.startsWith("ig_") ? "followers" : "subs"}{c.role === "competitor" ? " / rival" : ""}</div>
                      </div>
                      <span className="text-ink-3 transition group-hover:text-[var(--cyan)]">↗</span>
                    </div>
                    <div className="mt-7 grid grid-cols-2 gap-4">
                      <div>
                        <div className="mono" style={{ fontSize: 9.5 }}>Sentiment</div>
                        <div className="display mt-2 text-[28px]" style={{ color: (c.avg_sentiment ?? 0) >= 0 ? "var(--cyan)" : "var(--magenta)" }}><Decode value={Math.round((c.avg_sentiment ?? 0) * 100)} format="signed" /></div>
                      </div>
                      <div className="text-right">
                        <div className="mono" style={{ fontSize: 9.5 }}>Comments</div>
                        <div className="display mt-2 text-[28px]"><Decode value={c.comments} format="compact" /></div>
                      </div>
                    </div>
                    <div className="bar mt-5">
                      <span style={{ width: `${n ? (c.positive / n) * 100 : 0}%`, background: "var(--cyan)" }} />
                      <span style={{ width: `${n ? (c.neutral / n) * 100 : 0}%`, background: "var(--neutral)" }} />
                      <span style={{ width: `${n ? (c.negative / n) * 100 : 0}%`, background: "var(--magenta)" }} />
                    </div>
                    {!c.active && <div className="mono mt-3" style={{ color: "var(--magenta)", fontSize: 10 }}>Paused</div>}
                  </Link>
                );
              })}
            </div>
          </InView>

          {/* 06 · Signals */}
          <InView as="section" className="sec">
            <SigHead n={6} of={OF} label="Signals" title="What's happening right now.">
              AI briefings, alerts, new uploads against their usual, and the live feed. New comments slide in on their own.
            </SigHead>
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Latest AI briefings">
                {briefs.length === 0 ? <Empty>Briefings appear once the AI has read enough comments.</Empty> : (
                  <ul className="divide-y divide-[var(--hair)]">
                    {briefs.map((b) => (
                      <li key={`${b.scope}-${b.id}-${b.created_at}`}>
                        <Link href={b.scope === "video" ? `/videos/${b.id}` : `/channels/${b.id}`} className="group block py-3.5 first:pt-0">
                          <div className="mono flex items-center gap-2" style={{ fontSize: 9.5 }}><span style={{ color: "var(--cyan)" }}>{b.scope}</span>{ago(b.created_at)}</div>
                          <div className="mt-1.5 line-clamp-1 text-[14px] font-medium transition group-hover:text-[var(--cyan)]">{b.title}</div>
                          <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{b.summary}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <AlertsPanel alerts={alertList} />
            </div>
            {preds.length > 0 && <div className="mt-4"><NewVideosPanel preds={preds} /></div>}
            <div className="mt-4">
              <Panel title={<span className="flex items-center gap-2"><i className="live" />Live feed</span>}
                subtitle={focus ? "Newest comments on this channel" : "Newest comments across your channels; new ones slide in automatically"}
                action={<Link href="/comments" className="text-[13px] text-ink-3 hover:text-accent">All comments →</Link>}>
                {latest.length ? <LiveFeed comments={latest.slice(0, 8)} /> : <Empty>Comments appear here as they arrive.</Empty>}
              </Panel>
            </div>
          </InView>
        </>
      )}
    </div>
  );
}
