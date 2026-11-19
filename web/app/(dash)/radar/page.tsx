import Link from "next/link";
import { within } from "@/lib/cache";
import { focusChannel } from "@/lib/focus";
import { channels as getChannels } from "@/lib/queries";
import { radar, type RadarRow } from "@/lib/radar";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { ago, compact } from "@/lib/format";
import { RankBars } from "@/components/signal/Viz";

export const metadata = { title: "Competitor radar" };

export default async function RadarPage() {
  const chs = await getChannels();
  const focus = await focusChannel(chs.filter((c) => c.active).map((c) => c.id));
  const me = chs.find((c) => c.id === focus);
  if (!me) return (<><PageHeader eyebrow="Radar" title={<>Competitor <span className="glow-text">radar</span></>} /><Empty>Add one of your channels on the Manage page first.</Empty></>);
  const r = await within(radar(me.id), 15_000, { me: null, rivals: [], breakouts: [], gaps: [] });
  const rows = [r.me, ...r.rivals].filter(Boolean) as RadarRow[];
  return (
    <>
      <PageHeader eyebrow={`Radar · ${me.title}`} title={<>Competitor <span className="glow-text">radar</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Channels you mark as competitors (Manage → Watchlist) are tracked for videos and stats.
          See their pace, their breakouts and the topics they win on that you haven&apos;t covered yet.</p>
      </PageHeader>
      {r.rivals.length === 0 ? (
        <Empty>No competitors yet. Add a channel on <Link href="/manage" className="text-accent">Manage</Link>, then press “Mark as competitor” in the watchlist.</Empty>
      ) : (
        <>
          <div className="cell mb-10 p-5 md:p-8">
            <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">■ Typical views per video, you vs competitors</div>
            <RankBars axisLabel="Typical views (median of recent videos, log scale)" refValue={r.me?.medianViews ?? undefined} refLabel={`your typical views (${compact(r.me?.medianViews ?? 0)})`}
              ticks={radarTicks([r.me?.medianViews ?? 0, ...r.rivals.map((x) => x.medianViews ?? 0)])} fmt={compact}
              rows={[...(r.me ? [{ ...r.me, you: true }] : []), ...r.rivals.map((x) => ({ ...x, you: false }))].sort((x, y) => (y.medianViews ?? 0) - (x.medianViews ?? 0)).map((x) => ({
                id: x.id, label: x.title, href: `/channels/${x.id}`, value: x.medianViews, you: x.you, sub: `${x.uploads30} uploads in 30 days`,
                tag: (x.best ?? 0) >= 2 ? `★${x.best!.toFixed(1)}×` : undefined, color: x.you ? "#ededea" : (x.best ?? 0) >= 2 ? "#ff3d7f" : "#22e1ff" }))} />
            <p className="mt-3 font-mono text-[10px] text-ink-3">★ = a recent breakout at 2× their usual or more (magenta bar). Click a row to open the channel.</p>
          </div>
          <Reveal><Panel title="Side by side" subtitle="Last 30 days of uploads; typical views = median of recent videos">
            <div className="scrollbar-thin -mx-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13.5px]">
                <thead><tr className="text-left">{["Channel", "Subscribers", "Uploads / 30 d", "Typical views", "Best recent"].map((h) => <th key={h} className="label px-2 py-2 font-normal">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.id} className={x.id === me.id ? "text-accent" : ""}>
                      <td className="px-2 py-2"><Link href={`/channels/${x.id}`} className="flex items-center gap-2 hover:underline">
                        {x.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img loading="lazy" decoding="async" src={x.thumb} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />
                        ) : <span className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-[11px]">{x.title.slice(0, 1)}</span>}
                        <span className="truncate">{x.title}{x.id === me.id ? " (you)" : ""}</span></Link></td>
                      <td className="px-2 tabular">{compact(x.subs)}</td>
                      <td className="px-2 tabular">{x.uploads30}</td>
                      <td className="px-2 tabular">{compact(x.medianViews)}</td>
                      <td className="px-2 tabular">{x.best ? `${x.best.toFixed(1)}×` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel></Reveal>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <Reveal className="xl:col-span-2"><Panel title="Their breakouts" subtitle="Last 60 days, at least 2× that channel's usual views">
              {r.breakouts.length === 0 ? <Empty>No breakouts in the last 60 days.</Empty> : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {r.breakouts.map((b) => (
                    <li key={b.id}><Link href={`/videos/${b.id}`} className="flex gap-3 rounded-xl border border-line p-2.5 hover:border-accent/40">
                      <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">
                        {b.thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img loading="lazy" decoding="async" src={b.thumb} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        )}
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 font-mono text-[10px] text-accent">{b.outlier.toFixed(1)}×</span>
                      </div>
                      <div className="min-w-0"><div className="line-clamp-2 text-[13px] text-ink">{b.title}</div>
                        <div className="mt-0.5 text-[11.5px] text-ink-3">{b.channel} · {compact(b.views)} views · {ago(b.published_at)}</div></div>
                    </Link></li>
                  ))}
                </ul>
              )}
            </Panel></Reveal>
            <Reveal delay={0.05}><Panel title="Topic gaps" subtitle="Words in their strong titles that you've never used">
              {r.gaps.length === 0 ? <p className="text-[13px] text-ink-3">No clear gaps yet.</p> : (
                <ul className="space-y-2">
                  {r.gaps.map((g) => (
                    <li key={g.word} className="flex items-center justify-between gap-3 text-[13.5px]">
                      <Link href={`/studio`} className="text-ink hover:text-accent">{g.word}</Link>
                      <span className="font-mono text-[11.5px] text-ink-3">{g.videos} videos · {g.lift.toFixed(1)}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel></Reveal>
          </div>
        </>
      )}
    </>
  );
}

/** Powers of ten that cover every channel's typical views. */
function radarTicks(vals: number[]): number[] {
  const pos = vals.filter((v) => v > 0);
  const lo = Math.floor(Math.log10(Math.min(...pos, 100))), hi = Math.ceil(Math.log10(Math.max(...pos, 1000)));
  return Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i));
}
