import Link from "next/link";
import { within } from "@/lib/cache";
import { keywordReport, seedKeywords, type KeywordReport } from "@/lib/keywords";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { compact } from "@/lib/format";

export const metadata = { title: "Keywords" };

const times = (x: number) => (x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`);
const tone = (d: number) => (d >= 70 ? "#22d3ee" : d >= 45 ? "#8b7cf6" : d >= 20 ? "#fab219" : "#7c869b");

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const [report, seeds] = await Promise.all([
    q ? within(keywordReport(q), 20_000, null as KeywordReport | null) : Promise.resolve(null),
    within(seedKeywords(), 8000, [] as string[]),
  ]);

  return (
    <>
      <PageHeader eyebrow="Keywords · search demand" title={<>Search demand <span className="glow-text">&amp; keyword scores</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Type a topic or title phrase. Demand comes from YouTube&apos;s own search suggestions (what people
          actually type): the fewer letters needed before YouTube suggests it, the more it&apos;s searched. Opportunity adds how videos using it did in your niche.</p>
      </PageHeader>

      <Reveal>
        <form action="/keywords" className="panel holo mb-4 flex flex-wrap items-center gap-3 p-4">
          <input name="q" defaultValue={q} placeholder="e.g. tamil prank call" autoComplete="off" aria-label="Keyword"
            className="min-w-0 flex-1 rounded-xl border border-line-2 bg-black/40 px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/60 focus:shadow-[0_0_24px_-6px_#22d3ee]" />
          <button className="btn-neon rounded-xl px-5 py-3 text-[14px] font-medium">Score it</button>
          {seeds.length > 0 && (
            <div className="flex w-full flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="label mr-1">From your niche&apos;s breakouts</span>
              {seeds.map((s) => <Link key={s} href={`/keywords?q=${encodeURIComponent(s)}`} className="rounded-full px-3 py-1 text-ink-2 ring-1 ring-white/10 hover:text-accent hover:ring-accent/40">{s}</Link>)}
            </div>
          )}
        </form>
      </Reveal>

      {!q ? <Empty>Type a keyword above, or pick one from your niche&apos;s breakouts.</Empty>
        : !report ? <Empty>YouTube&apos;s suggestions didn&apos;t answer in time. Try again in a moment.</Empty> : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Reveal><Panel title="Search demand" subtitle={`“${report.keyword}”`}>
                <Gauge value={report.demand} label={report.label} />
              </Panel></Reveal>
              <Reveal delay={0.05}><Panel title="Opportunity" subtitle="Demand, plus how this topic performed in your niche">
                <Gauge value={report.opportunity} label={report.opportunity >= report.demand + 5 ? "Proven in your niche" : report.opportunity <= report.demand - 5 ? "Underperformed in your niche" : "Untested in your niche"} />
              </Panel></Reveal>
              <Reveal delay={0.1}><Panel title="In your niche" subtitle="Tracked uploads whose title uses it">
                {report.niche.videos ? (
                  <div className="space-y-3">
                    <div className="flex items-baseline gap-3">
                      <span className="font-[family-name:var(--font-display)] text-4xl font-semibold tabular text-ink">{report.niche.videos}</span>
                      <span className="text-[13px] text-ink-3">uploads · typical result <span className="text-accent">{report.niche.medianScore ? times(report.niche.medianScore) : "–"}</span> their channel&apos;s normal</span>
                    </div>
                    <ul className="space-y-2">
                      {report.niche.best.map((v) => (
                        <li key={v.id}><Link href={`/videos/${v.id}`} className="flex items-center gap-3 text-[13px] hover:text-accent">
                          <span className="w-12 shrink-0 tabular text-accent">{times(v.score)}</span>
                          <span className="truncate text-ink-2">{v.title}</span>
                          <span className="ml-auto shrink-0 tabular text-ink-3">{compact(v.views)}</span></Link></li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="text-[13px] text-ink-3">No tracked upload uses this yet. That can mean open ground: demand without competition from your niche.</p>}
              </Panel></Reveal>
            </div>

            <Reveal delay={0.05} className="mt-4"><Panel title="What people also search" subtitle="YouTube's suggestions for this keyword; demand measured for the first five">
              {report.related.length ? (
                <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                  {report.related.map((r, i) => (
                    <li key={r.q}>
                      <Link href={`/keywords?q=${encodeURIComponent(r.q)}`} className="group block">
                        <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                          <span className="truncate text-ink group-hover:text-accent">{r.q}</span>
                          <span className="shrink-0 tabular text-[12px]" style={{ color: r.demand === null ? undefined : tone(r.demand) }}>
                            {r.demand === null ? <span className="text-ink-3">score it →</span> : r.demand}</span>
                        </div>
                        {r.demand !== null && (
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                            <div className="grow-x h-full rounded-full" style={{ width: `${Math.max(3, r.demand)}%`, animationDelay: `${i * 60}ms`,
                              background: `linear-gradient(90deg, rgba(139,124,246,.6), ${tone(r.demand)})` }} />
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <Empty>YouTube suggests nothing more for this phrase.</Empty>}
            </Panel></Reveal>
          </>
        )}
    </>
  );
}

function Gauge({ value, label }: { value: number; label: string }) {
  const c = tone(value);
  return (
    <div className="flex items-center gap-5">
      <div className="score-ring grid h-28 w-28 shrink-0 place-items-center rounded-full" style={{ "--p": value, "--ring": c } as React.CSSProperties}>
        <span className="font-[family-name:var(--font-display)] text-3xl font-semibold tabular" style={{ color: c }}>{value}</span>
      </div>
      <div>
        <div className="text-[15px] font-medium text-ink">{label}</div>
        <div className="mt-1 text-[12.5px] text-ink-3">out of 100</div>
      </div>
    </div>
  );
}
