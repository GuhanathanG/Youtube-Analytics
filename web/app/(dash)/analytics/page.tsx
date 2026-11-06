import Link from "next/link";
import { Heatmap, MiniStat, OutlierBadge, Sparkline, SplitBar, Trend, times } from "@/components/AnalyticsParts";
import { BarList } from "@/components/charts/BarList";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel, Tag } from "@/components/ui";
import { audienceAnalytics, channelAnalytics, channelTopics, type VideoPerf } from "@/lib/analytics";
import { compact, score } from "@/lib/format";
import { channels as getChannels } from "@/lib/queries";

export const metadata = { title: "Analytics" };

const pctText = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`);
const LANG_COLORS = ["#22d3ee", "#8b7cf6", "#3987e5", "#fab219", "#e66767", "#7c869b"];
const LANG_NAMES: Record<string, string> = { en: "English", ta: "Tamil", hi: "Hindi", te: "Telugu", ml: "Malayalam", kn: "Kannada", und: "Unknown", other: "Other" };

function VideoRow({ v }: { v: VideoPerf }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {v.thumbnail_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={v.thumbnail_url} alt="" className="h-9 w-16 shrink-0 rounded-md object-cover ring-1 ring-white/10" />
        : <div className="h-9 w-16 shrink-0 rounded-md bg-white/5" />}
      <Link href={`/videos/${v.id}`} className="min-w-0 flex-1 truncate text-[13.5px] text-ink hover:text-accent">{v.title}</Link>
      <span className="hidden tabular text-[12.5px] text-ink-3 sm:inline">{compact(v.views)} views</span>
      <OutlierBadge value={v.outlier} />
    </li>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const all = await getChannels();
  const requested = (await searchParams).c;
  const ch = all.find((c) => c.id === requested) ?? all[0];
  if (!ch) {
    return (
      <>
        <PageHeader eyebrow="Analytics" title={<>Advanced <span className="glow-text">analytics</span></>} />
        <Empty>Add a channel on the Manage page first.</Empty>
      </>
    );
  }
  const [a, aud, topics] = await Promise.all([channelAnalytics(ch.id), audienceAnalytics(ch.id), channelTopics(ch.id)]);
  const { shorts, long } = a.formats;
  const maxPeople = Math.max(1, ...aud.perVideo.map((v) => v.commenters));
  const maxMonth = Math.max(1, ...aud.monthly.map((m) => m.commenters));

  return (
    <>
      <PageHeader eyebrow="Analytics" title={<>Advanced <span className="glow-text">analytics</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">
          What works for this channel: which videos beat its usual, the best times and title styles, who keeps coming back, and which topics are rising.
          Calculated from stored data, so it costs no AI quota.
        </p>
      </PageHeader>

      <div className="mb-5 flex flex-wrap gap-2">
        {all.map((c) => (
          <Link key={c.id} href={`/analytics?c=${encodeURIComponent(c.id)}`} scroll={false} aria-current={c.id === ch.id ? "page" : undefined}
            className={`rounded-xl border px-3 py-2 text-[13px] transition ${c.id === ch.id ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-ink-3 hover:text-ink-2"}`}>
            {c.title}
          </Link>
        ))}
      </div>

      {/* ---------------------------------------------------------------- 1. video performance */}
      <h2 className="label mb-3 mt-2">1 · Video performance</h2>
      <Reveal>
        <Panel title="Shorts vs long videos" subtitle="Typical (median) results of videos at least 3 days old">
          <div className="grid gap-3 sm:grid-cols-2">
            {([["Shorts", shorts], ["Long videos", long]] as const).map(([name, g]) => (
              <div key={name} className="rounded-xl border border-line p-4">
                <div className="flex items-baseline justify-between"><span className="text-[14px] font-medium text-ink">{name}</span><span className="text-[12.5px] text-ink-3">{g.count} videos</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <MiniStat label="Views" value={compact(g.medianViews)} />
                  <MiniStat label="Like rate" value={pctText(g.medianLikeRate, 2)} />
                  <MiniStat label="Comment rate" value={pctText(g.medianCommentRate, 2)} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </Reveal>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal>
          <Panel title="Breakout videos" subtitle="Most views compared with the channel's usual for that format (1× = typical)">
            {a.top.length ? <ul className="divide-y divide-line">{a.top.map((v) => <VideoRow key={v.id} v={v} />)}</ul> : <Empty>Needs a few videos older than 3 days.</Empty>}
          </Panel>
        </Reveal>
        <Reveal delay={0.05}>
          <Panel title="Underperformers" subtitle="Fewest views compared with the usual">
            {a.bottom.length ? <ul className="divide-y divide-line">{a.bottom.map((v) => <VideoRow key={v.id} v={v} />)}</ul> : <Empty>Needs a few videos older than 3 days.</Empty>}
          </Panel>
        </Reveal>
      </div>

      <Reveal className="mt-4">
        <Panel title="Early growth" subtitle="Views in the first 24 hours, from the engine's regular snapshots (videos from the last 6 months)">
          {a.early.median24 === null ? <Empty>Builds up as new videos are tracked from the day they&apos;re uploaded.</Empty> : (
            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
                <MiniStat label="Usual after 24 h" value={compact(a.early.median24)} />
                <MiniStat label="Usual after 48 h" value={compact(a.early.median48)} />
              </div>
              <ul className="divide-y divide-line">
                {a.early.videos.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-2 text-[13.5px]">
                    <Link href={`/videos/${v.id}`} className="min-w-0 flex-1 truncate text-ink hover:text-accent">{v.title}</Link>
                    <span className="tabular text-ink-3">{compact(v.views24)} in 24 h</span>
                    <OutlierBadge value={v.ratio} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- 2. best time & format */}
      <h2 className="label mb-3 mt-8">2 · Best time and format</h2>
      <Reveal>
        <Panel title="When uploads do best" subtitle={`Typical result by upload day and time (${a.timezone.replace("_", " ")}). Blue = above the usual, red = below; faded numbers come from fewer than 3 videos.`}
          action={a.heatmap.best ? <Tag tone="accent">Best: {a.heatmap.best.day} {a.heatmap.best.block} h · {times(a.heatmap.best.outlier)}</Tag> : undefined}>
          <Heatmap days={a.heatmap.days} blocks={a.heatmap.blocks} cells={a.heatmap.cells} />
        </Panel>
      </Reveal>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal>
          <Panel title="Title styles" subtitle="Typical result of titles with vs without each style (needs 3+ videos each way)">
            {a.titleFeatures.length ? (
              <ul className="space-y-2.5">
                {a.titleFeatures.map((f) => (
                  <li key={f.label} className="flex items-center gap-3 text-[13.5px]">
                    <span className="min-w-0 flex-1 truncate text-ink-2">{f.label} <span className="text-ink-3">({f.with} videos)</span></span>
                    <span className="tabular text-ink-3">{times(f.withOutlier)} vs {times(f.withoutOutlier)}</span>
                    <span className={`tabular w-14 text-right font-medium ${(f.lift ?? 1) >= 1.15 ? "text-accent" : (f.lift ?? 1) <= 0.87 ? "text-neg" : "text-ink-2"}`}>
                      {(f.lift ?? 1) >= 1 ? "+" : "−"}{Math.abs(Math.round(((f.lift ?? 1) - 1) * 100))}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty>Needs more videos.</Empty>}
          </Panel>
        </Reveal>
        <Reveal delay={0.05}>
          <Panel title="Words in winning titles" subtitle="Title words used in 3+ videos, by typical result">
            {a.titleWords.length ? (
              <div className="flex flex-wrap gap-1.5">
                {a.titleWords.slice(0, 14).map((w) => (
                  <span key={w.word} className={`rounded-full px-2.5 py-1 text-[12.5px] ring-1 ${w.outlier >= 1.2 ? "bg-accent/10 text-accent ring-accent/25" : w.outlier <= 0.8 ? "bg-neg/10 text-[#f3a9a9] ring-neg/25" : "bg-white/5 text-ink-2 ring-white/10"}`}
                    title={`${w.count} videos`}>
                    {w.word} <span className="tabular opacity-70">{times(w.outlier)}</span>
                  </span>
                ))}
              </div>
            ) : <Empty>Needs more videos with repeated title words.</Empty>}
          </Panel>
        </Reveal>
      </div>

      <Reveal className="mt-4">
        <Panel title="Video length" subtitle="Typical result by length">
          <BarList rows={a.lengths.map((l) => ({ label: l.label, value: l.count, hint: `typical ${times(l.outlier)} · ${compact(l.medianViews)} views` }))} color="#8b7cf6" empty="Needs more videos." />
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- 3. audience */}
      <h2 className="label mb-3 mt-8">3 · Audience</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Loyal viewers (90 days)" value={pctText(aud.loyal.loyalShare, 0)} hint={`${compact(aud.loyal.loyal)} of ${compact(aud.loyal.people)} commenters wrote on 3+ videos`} />
        <MiniStat label="Creator reply rate (90 days)" value={pctText(aud.creator.replyRate, 1)} hint={`${compact(aud.creator.answered)} of ${compact(aud.creator.topLevel)} comments answered`} />
        <MiniStat label="Commenters this month" value={compact(aud.monthly.at(-1)?.commenters ?? 0)}
          hint={aud.monthly.at(-1) ? `${pctText((aud.monthly.at(-1)!.returning) / Math.max(1, aud.monthly.at(-1)!.commenters), 0)} came back from earlier months` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Reveal>
          <Panel title="New vs returning commenters" subtitle="Latest videos. Returning = commented on an earlier video of this channel"
            action={<span className="flex gap-3 text-[12px] text-ink-3"><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent-2" />returning</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />new</span></span>}>
            {aud.perVideo.length ? (
              <ul className="space-y-3">
                {aud.perVideo.map((v) => (
                  <li key={v.id}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                      <Link href={`/videos/${v.id}`} className="min-w-0 truncate text-ink-2 hover:text-accent">{v.title}</Link>
                      <span className="tabular text-ink-3">{v.returning} / {v.commenters}</span>
                    </div>
                    <SplitBar a={v.returning} b={v.newPeople} aColor="#8b7cf6" bColor="#22d3ee" max={maxPeople} />
                  </li>
                ))}
              </ul>
            ) : <Empty>No commenters stored yet.</Empty>}
          </Panel>
        </Reveal>
        <Reveal delay={0.05}>
          <Panel title="Commenters by month" subtitle="How many people commented, and how many had commented in an earlier month">
            {aud.monthly.length ? (
              <ul className="space-y-3">
                {aud.monthly.map((m) => (
                  <li key={m.month}>
                    <div className="mb-1 flex justify-between text-[13px]"><span className="text-ink-2">{m.month}</span>
                      <span className="tabular text-ink-3">{compact(m.commenters)} people · {pctText(m.returning / Math.max(1, m.commenters), 0)} returning</span></div>
                    <SplitBar a={m.returning} b={m.commenters - m.returning} aColor="#8b7cf6" bColor="#22d3ee" max={maxMonth} />
                  </li>
                ))}
              </ul>
            ) : <Empty>No comments in the last 6 months.</Empty>}
            <p className="mt-4 text-[12px] text-ink-3">While older comment history is still downloading, some returning viewers show up as new.</p>
          </Panel>
        </Reveal>
      </div>

      <Reveal className="mt-4">
        <Panel title="Languages over time" subtitle="Share of comments per month">
          {aud.languages.length ? (
            <>
              <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-ink-3">
                {[...aud.topLanguages, "other"].map((l, i) => (
                  <span key={l}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: LANG_COLORS[i] }} />{LANG_NAMES[l] ?? l}</span>
                ))}
              </div>
              <ul className="space-y-2.5">
                {aud.languages.map((m) => {
                  const total = Object.values(m.counts).reduce((s, n) => s + n, 0) || 1;
                  return (
                    <li key={m.month} className="flex items-center gap-3 text-[13px]">
                      <span className="w-16 text-ink-3">{m.month}</span>
                      <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
                        {[...aud.topLanguages, "other"].map((l, i) => (
                          <div key={l} style={{ width: `${((m.counts[l] ?? 0) / total) * 100}%`, background: LANG_COLORS[i] }}
                            title={`${LANG_NAMES[l] ?? l}: ${m.counts[l] ?? 0}`} />
                        ))}
                      </div>
                      <span className="w-14 text-right tabular text-ink-3">{compact(total)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : <Empty>No comments in the last 6 months.</Empty>}
        </Panel>
      </Reveal>

      {/* ---------------------------------------------------------------- 4. topics */}
      <h2 className="label mb-3 mt-8">4 · Comment topics and trends</h2>
      <Reveal>
        <Panel title="What people talk about" subtitle="Similar comments from the last 90 days grouped automatically (any language). Trend = share of the last 14 days vs the 14 days before. Rebuilt daily by the background job.">
          {topics.length ? (
            <ul className="divide-y divide-line">
              {topics.map((t) => {
                const weeks = Object.values(t.weekly);
                return (
                  <li key={t.label} className="grid gap-2 py-3.5 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-ink">{t.label}</span>
                        <span className="tabular text-[12px] text-ink-3">{(t.share * 100).toFixed(0)}% of comments · {compact(t.size)}</span>
                        <Trend pct={t.trend_pct} />
                        <span className={`text-[12px] ${(t.sentiment ?? 0) < -0.1 ? "text-neg" : (t.sentiment ?? 0) > 0.2 ? "text-pos" : "text-ink-3"}`}>
                          mood {score(t.sentiment)}{t.negative_pct !== null ? ` · ${t.negative_pct.toFixed(0)}% negative` : ""}
                        </span>
                      </div>
                      {t.keywords && <div className="mt-1 text-[12.5px] text-ink-3">{t.keywords}</div>}
                      {t.examples[0] && <div className="mt-1.5 truncate text-[13px] text-ink-2">“{t.examples[0].text}”</div>}
                    </div>
                    <Sparkline values={weeks} color={(t.sentiment ?? 0) < -0.1 ? "#e66767" : "#22d3ee"} />
                  </li>
                );
              })}
            </ul>
          ) : <Empty>Topic groups appear after the background job&apos;s next daily run (it needs at least 60 recent comments).</Empty>}
        </Panel>
      </Reveal>
    </>
  );
}
