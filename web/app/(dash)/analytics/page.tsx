import Link from "next/link";
import { within } from "@/lib/cache";
import { focusChannel } from "@/lib/focus";
import { Heatmap, MiniStat, OutlierBadge, Sparkline, SplitBar, Trend, times } from "@/components/AnalyticsParts";
import { BarList } from "@/components/charts/BarList";
import { Empty, Panel } from "@/components/ui";
import { InView, Words } from "@/components/signal/InView";
import { Decode } from "@/components/signal/Decode";
import { SigHead } from "@/components/signal/Head";
import { LiftBars, RankBars } from "@/components/signal/Viz";
import { OutlierScatter } from "@/components/signal/OutlierScatter";
import { audienceAnalytics, channelAnalytics, channelTopics, type VideoPerf } from "@/lib/analytics";
import { BrandsPanel, HealthCard } from "@/components/CreatorPanels";
import { brandTracker, channelHealth } from "@/lib/creator-insights";
import { thumbnailsFor } from "@/lib/thumbnails";
import { THUMB_FEATURES, featureLift } from "@/lib/analytics-math";
import { compact, score } from "@/lib/format";
import { channels as getChannels } from "@/lib/queries";

export const metadata = { title: "Analytics" };

const pctText = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`);
const LANG_COLORS = ["#22e1ff", "#ff3d7f", "#ededea", "#8a8a93", "#1f8ea3", "#55555e"];
const OF = 6;
const LANG_NAMES: Record<string, string> = { en: "English", ta: "Tamil", hi: "Hindi", te: "Telugu", ml: "Malayalam", kn: "Kannada", und: "Unknown", other: "Other" };

function VideoRow({ v }: { v: VideoPerf }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {v.thumbnail_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img loading="lazy" decoding="async" src={v.thumbnail_url} alt="" className="h-9 w-16 shrink-0 object-cover ring-1 ring-white/10" />
        : <div className="h-9 w-16 shrink-0 bg-white/5" />}
      <Link href={`/videos/${v.id}`} className="min-w-0 flex-1 truncate text-[14px] text-ink hover:text-accent">{v.title}</Link>
      <span className="hidden font-mono text-[10.5px] tabular text-ink-3 sm:inline">{compact(v.views)} views</span>
      <OutlierBadge value={v.outlier} />
    </li>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const all = await getChannels();
  const requested = (await searchParams).c ?? (await focusChannel(all.filter((c) => c.active).map((c) => c.id)));
  const ch = all.find((c) => c.id === requested) ?? all[0];
  if (!ch) {
    return (
      <div className="sig"><h1 className="display text-[36px]">Advanced analytics</h1><div className="mt-6"><Empty>Add a channel on the Manage page first.</Empty></div></div>
    );
  }
  const [a, aud, topics, health, brands] = await Promise.all([channelAnalytics(ch.id), within(audienceAnalytics(ch.id), 15000, { perVideo: [], monthly: [], languages: [], topLanguages: [],
      creator: { topLevel: 0, answered: 0, replies: 0, replyRate: null }, loyal: { people: 0, loyal: 0, loyalShare: null } }), within(channelTopics(ch.id), 15000, []),
    within(channelHealth(ch.id), 20000, { score: null, grade: "–", parts: [], weekly: [] }), within(brandTracker(ch.id), 20000, [])]);
  const thumbs = await within(thumbnailsFor(ch.id), 10000, new Map());
  const thumbItems = a.videos.filter((v) => v.outlier !== null && thumbs.has(v.id)).map((v) => ({ outlier: v.outlier!, data: thumbs.get(v.id)! }));
  const thumbLift = featureLift(thumbItems, THUMB_FEATURES);
  const { shorts, long } = a.formats;
  const maxPeople = Math.max(1, ...aud.perVideo.map((v) => v.commenters));
  const maxMonth = Math.max(1, ...aud.monthly.map((m) => m.commenters));

  const lift = (rows: { label: string; with: number; withOutlier: number | null; withoutOutlier: number | null; lift: number | null }[]) =>
    rows.map((f) => ({ label: f.label, n: f.with, withX: f.withOutlier, withoutX: f.withoutOutlier, lift: f.lift }));
  const duel = [["Shorts", shorts], ["Long videos", long]] as const;
  const maxViews = Math.max(1, shorts.medianViews ?? 0, long.medianViews ?? 0);

  return (
    <div className="sig">
      <InView as="section" className="sec">
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ Analytics · {ch.title}</div>
        <h1 className="display mt-5 text-[38px] md:text-[56px]"><span className="sr-only">Advanced analytics. </span><Words text="What works for this channel." /></h1>
        <p className="rise lede mt-6" style={{ transitionDelay: "300ms" }}>
          Which videos beat its usual, the best times and title styles, who keeps coming back, and which topics are rising.
          Calculated from stored data, so it costs no AI quota.
        </p>
        <div className="rise mt-8 flex flex-wrap gap-2" style={{ transitionDelay: "400ms" }}>
          {all.map((c) => (
            <Link key={c.id} href={`/analytics?c=${encodeURIComponent(c.id)}`} scroll={false} aria-current={c.id === ch.id ? "page" : undefined}
              className={`pill ${c.id === ch.id ? "pill-on" : "pill-line"}`} style={{ padding: "6px 14px", fontSize: 12.5 }}>{c.title}</Link>
          ))}
        </div>
      </InView>

      <InView as="section" className="sec">
        <SigHead n={1} of={OF} label="Health" title="One score for the whole channel." />
        <HealthCard h={health} />
      </InView>

      {/* ---------------------------------------------------------------- video performance */}
      <InView as="section" className="sec">
        <SigHead n={2} of={OF} label="Video performance" title="Every upload, against its usual.">
          Each dot is an upload: across = when it went out, up = views as a multiple of this channel&apos;s usual for that format. Above the white line beat the usual; magenta dots are breakouts (2×+). Hover a dot for the title; click to open it. Drag the slider to pick a period.
        </SigHead>
        <div className="cell mb-8 p-5 md:p-8">
          <OutlierScatter videos={a.videos.map((v) => ({ id: v.id, title: v.title, outlier: v.outlier, views: v.views, date: v.published_at }))} />
        </div>
        <div className="grid gap-10">
          <Panel title="Shorts vs long videos" subtitle="Typical (median) results of videos at least 3 days old">
            <div className="grid gap-px bg-[var(--hair)] sm:grid-cols-2">
              {duel.map(([name, g], i) => (
                <div key={name} className="bg-[#0b0b10] p-5" style={{ containerType: "inline-size" }}>
                  <div className="mono flex justify-between" style={{ fontSize: 10 }}><span style={{ color: i ? "var(--ink)" : "var(--cyan)" }}>{name}</span><span>{g.count} videos</span></div>
                  <div className="display mt-4 whitespace-nowrap" style={{ fontSize: "min(36px, 14cqw)", color: i ? "var(--ink)" : "var(--cyan)" }}>{g.medianViews === null ? "–" : <Decode value={g.medianViews} format="compact" />}</div>
                  <div className="mono mt-1" style={{ fontSize: 9.5 }}>Typical views</div>
                  <div className="mt-4 h-1.5 bg-white/5"><div className="lift-bar h-1.5" style={{ width: `${((g.medianViews ?? 0) / maxViews) * 100}%`, background: i ? "var(--ink)" : "var(--cyan)", transformOrigin: "left" }} /></div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <MiniStat label="Like rate" value={pctText(g.medianLikeRate, 2)} />
                    <MiniStat label="Comment rate" value={pctText(g.medianCommentRate, 2)} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Panel title="Breakout videos" subtitle="Most views compared with the channel's usual for that format (1× = typical)">
            {a.top.length ? <ul className="divide-y divide-line">{a.top.map((v) => <VideoRow key={v.id} v={v} />)}</ul> : <Empty>Needs a few videos older than 3 days.</Empty>}
          </Panel>
          <Panel title="Underperformers" subtitle="Fewest views compared with the usual">
            {a.bottom.length ? <ul className="divide-y divide-line">{a.bottom.map((v) => <VideoRow key={v.id} v={v} />)}</ul> : <Empty>Needs a few videos older than 3 days.</Empty>}
          </Panel>
        </div>
        <div className="mt-4">
          <Panel title="Early growth" subtitle="Views in the first 24 hours, from the engine's regular snapshots (videos from the last 6 months)">
            {a.early.median24 === null ? <Empty>Builds up as new videos are tracked from the day they&apos;re uploaded.</Empty> : (
              <div className="grid gap-5 md:grid-cols-[220px_1fr]">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
                  <MiniStat label="Usual after 24 h" value={compact(a.early.median24)} />
                  <MiniStat label="Usual after 48 h" value={compact(a.early.median48)} />
                </div>
                <ul className="divide-y divide-line">
                  {a.early.videos.map((v) => (
                    <li key={v.id} className="flex items-center gap-3 py-2.5 text-[14px]">
                      <Link href={`/videos/${v.id}`} className="min-w-0 flex-1 truncate text-ink hover:text-accent">{v.title}</Link>
                      <span className="font-mono text-[10.5px] tabular text-ink-3">{compact(v.views24)} in 24 h</span>
                      <OutlierBadge value={v.ratio} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        </div>
      </InView>

      {/* ---------------------------------------------------------------- best time & format */}
      <InView as="section" className="sec">
        <SigHead n={3} of={OF} label="Best time and format" title="When, how long, and how to title it."
          action={a.heatmap.best ? <span className="pill pill-on w-fit" style={{ padding: "6px 14px", fontSize: 12.5 }}>Best: {a.heatmap.best.day} {a.heatmap.best.block} h · {times(a.heatmap.best.outlier)}</span> : undefined} />
        <Panel title="When uploads do best" subtitle={`Typical result by upload day and time (${a.timezone.replace("_", " ")}). Cyan = above the usual, magenta = below; faded numbers come from fewer than 3 videos.`}>
          <Heatmap days={a.heatmap.days} blocks={a.heatmap.blocks} cells={a.heatmap.cells} />
        </Panel>
        <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Panel title="Title styles" subtitle="Typical result of titles with vs without each style (needs 3+ videos each way)">
            {a.titleFeatures.length ? <LiftBars rows={lift(a.titleFeatures)} /> : <Empty>Needs more videos.</Empty>}
          </Panel>
          <Panel title="Words in winning titles" subtitle="Title words used in 3+ videos, ranked by the typical result of videos that use them">
            {a.titleWords.length ? <RankBars axisLabel="Typical views vs usual" fromRef refValue={1} refLabel="the channel's usual (1×)" ticks={[0.25, 0.5, 1, 2, 4]} fmt={(x) => times(x, x < 1 ? 2 : 1)}
              rows={[...a.titleWords].sort((x, y) => y.outlier - x.outlier).slice(0, 14).map((w) => ({ id: w.word, label: w.word, sub: `${w.count} videos`, value: w.outlier,
                color: w.outlier >= 1.2 ? "#22e1ff" : w.outlier <= 0.8 ? "#ff3d7f" : "#b4b4bb" }))} /> : <Empty>Needs more videos with repeated title words.</Empty>}
          </Panel>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Panel title="Thumbnail styles" subtitle={`What the AI sees in thumbnails vs results (${thumbItems.length} thumbnails analysed; needs 3+ each way)`}>
            {thumbLift.length ? <LiftBars rows={lift(thumbLift)} />
              : <Empty>Thumbnails are analysed by the AI every 2 hours (25 at a time, on the video-analysis timer). Results appear once enough are done.</Empty>}
          </Panel>
          <Panel title="Video length" subtitle="Typical result by length">
            <BarList rows={a.lengths.map((l) => ({ label: l.label, value: l.count, hint: `typical ${times(l.outlier)} · ${compact(l.medianViews)} views` }))} color="#22e1ff" empty="Needs more videos." />
          </Panel>
        </div>
      </InView>

      {/* ---------------------------------------------------------------- audience */}
      <InView as="section" className="sec">
        <SigHead n={4} of={OF} label="Audience" title="Who keeps coming back." />
        <div className="grid border-l border-t border-[var(--hair)] sm:grid-cols-3">
          {([["Loyal viewers (90 days)", (aud.loyal.loyalShare ?? 0) * 100, "pct", `${compact(aud.loyal.loyal)} of ${compact(aud.loyal.people)} commenters wrote on 3+ videos`, "var(--cyan)"],
            ["Creator reply rate (90 days)", (aud.creator.replyRate ?? 0) * 100, "pct", `${compact(aud.creator.answered)} of ${compact(aud.creator.topLevel)} comments answered`, "var(--magenta)"],
            ["Commenters this month", aud.monthly.at(-1)?.commenters ?? 0, "compact",
              aud.monthly.at(-1) ? `${pctText((aud.monthly.at(-1)!.returning) / Math.max(1, aud.monthly.at(-1)!.commenters), 0)} came back from earlier months` : "", "var(--ink)"]] as const).map(([l, v, f, hint, col], i) => (
            <div key={l} className="border-b border-r border-[var(--hair)] p-6" style={{ containerType: "inline-size" }}>
              <div className="mono" style={{ fontSize: 10 }}>{l}</div>
              <div className="display mt-4 whitespace-nowrap" style={{ color: col, fontSize: "min(38px, 14cqw)" }}><Decode value={v} format={f} delay={i * 120} /></div>
              {hint && <div className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{hint}</div>}
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Panel title="New vs returning commenters" subtitle="Latest videos. Returning = commented on an earlier video of this channel"
            action={<span className="flex gap-3 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3"><span><span className="mr-1 inline-block h-2 w-2 bg-accent" />returning</span><span><span className="mr-1 inline-block h-2 w-2 bg-[#55555e]" />new</span></span>}>
            {aud.perVideo.length ? (
              <ul className="space-y-3.5">
                {aud.perVideo.map((v) => (
                  <li key={v.id}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13.5px]">
                      <Link href={`/videos/${v.id}`} className="min-w-0 truncate text-ink-2 hover:text-accent">{v.title}</Link>
                      <span className="font-mono text-[10.5px] tabular text-ink-3">{v.returning} / {v.commenters}</span>
                    </div>
                    <SplitBar a={v.returning} b={v.newPeople} max={maxPeople} />
                  </li>
                ))}
              </ul>
            ) : <Empty>No commenters stored yet.</Empty>}
          </Panel>
          <Panel title="Commenters by month" subtitle="How many people commented, and how many had commented in an earlier month">
            {aud.monthly.length ? (
              <ul className="space-y-3.5">
                {aud.monthly.map((m) => (
                  <li key={m.month}>
                    <div className="mb-1.5 flex justify-between text-[13.5px]"><span className="text-ink-2">{m.month}</span>
                      <span className="font-mono text-[10.5px] tabular text-ink-3">{compact(m.commenters)} people · {pctText(m.returning / Math.max(1, m.commenters), 0)} returning</span></div>
                    <SplitBar a={m.returning} b={m.commenters - m.returning} max={maxMonth} />
                  </li>
                ))}
              </ul>
            ) : <Empty>No comments in the last 6 months.</Empty>}
            <p className="mt-4 text-[12.5px] text-ink-3">While older comment history is still downloading, some returning viewers show up as new.</p>
          </Panel>
        </div>
        <div className="mt-4">
          <Panel title="Languages over time" subtitle="Share of comments per month">
            {aud.languages.length ? (
              <>
                <div className="mb-4 flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                  {[...aud.topLanguages, "other"].map((l, i) => (
                    <span key={l}><span className="mr-1.5 inline-block h-2 w-2" style={{ background: LANG_COLORS[i] }} />{LANG_NAMES[l] ?? l}</span>
                  ))}
                </div>
                <ul className="space-y-3">
                  {aud.languages.map((m) => {
                    const total = Object.values(m.counts).reduce((s, n) => s + n, 0) || 1;
                    return (
                      <li key={m.month} className="flex items-center gap-3 text-[13px]">
                        <span className="w-16 font-mono text-[10.5px] text-ink-3">{m.month}</span>
                        <div className="flex h-2 flex-1 overflow-hidden bg-white/5">
                          {[...aud.topLanguages, "other"].map((l, i) => (
                            <div key={l} style={{ width: `${((m.counts[l] ?? 0) / total) * 100}%`, background: LANG_COLORS[i] }}
                              title={`${LANG_NAMES[l] ?? l}: ${m.counts[l] ?? 0}`} />
                          ))}
                        </div>
                        <span className="w-14 text-right font-mono text-[10.5px] tabular text-ink-3">{compact(total)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : <Empty>No comments in the last 6 months.</Empty>}
          </Panel>
        </div>
      </InView>

      {/* ---------------------------------------------------------------- topics */}
      <InView as="section" className="sec">
        <SigHead n={5} of={OF} label="Comment topics and trends" title="What people talk about.">
          Similar comments from the last 90 days grouped automatically, in any language. Trend compares the last 14 days with the 14 before. Rebuilt daily.
        </SigHead>
        <Panel>
          {topics.length ? (
            <ul className="divide-y divide-line">
              {topics.map((t) => {
                const weeks = Object.values(t.weekly);
                return (
                  <li key={t.label} className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-[15px] font-medium text-ink">{t.label}</span>
                        <span className="font-mono text-[10.5px] tabular text-ink-3">{(t.share * 100).toFixed(0)}% of comments · {compact(t.size)}</span>
                        <Trend pct={t.trend_pct} />
                        <span className={`font-mono text-[10.5px] ${(t.sentiment ?? 0) < -0.1 ? "text-neg" : (t.sentiment ?? 0) > 0.2 ? "text-pos" : "text-ink-3"}`}>
                          mood {score(t.sentiment)}{t.negative_pct !== null ? ` · ${t.negative_pct.toFixed(0)}% negative` : ""}
                        </span>
                      </div>
                      {t.keywords && <div className="mt-1.5 text-[13px] text-ink-3">{t.keywords}</div>}
                      {t.examples[0] && <div className="mt-1.5 truncate text-[13.5px] text-ink-2">“{t.examples[0].text}”</div>}
                    </div>
                    <Sparkline values={weeks} color={(t.sentiment ?? 0) < -0.1 ? "#ff3d7f" : "#22e1ff"} />
                  </li>
                );
              })}
            </ul>
          ) : <Empty>Topic groups appear after the background job&apos;s next daily run (it needs at least 60 recent comments).</Empty>}
        </Panel>
      </InView>

      {/* ---------------------------------------------------------------- brands */}
      <InView as="section" className="sec">
        <SigHead n={6} of={OF} label="Brands and sponsors" title="Who appears in the videos." />
        <BrandsPanel brands={brands} />
      </InView>
    </div>
  );
}
