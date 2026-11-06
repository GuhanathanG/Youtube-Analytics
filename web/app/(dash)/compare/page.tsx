import Link from "next/link";
import { CompareChart, SERIES } from "@/components/charts/CompareChart";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { compareChannels } from "@/lib/features";
import { channelHealth } from "@/lib/creator-insights";
import { compact, score } from "@/lib/format";
import { channels as getChannels } from "@/lib/queries";

export const metadata = { title: "Compare" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const all = await getChannels();
  const raw = (await searchParams).c;
  // Validate the shape only; compareChannels reads the database, so a channel added seconds ago (not yet in the 30 s cache) still counts.
  let ids = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).filter((id) => /^UC[\w-]{22}$/.test(id)))].slice(0, 4);
  if (!ids.length) ids = all.slice(0, 4).map((c) => c.id);
  let { rows, weekly, overlap } = await compareChannels(ids);
  if (rows.length < ids.length) { // drop ids that aren't tracked channels
    ids = ids.filter((id) => rows.some((r) => r.id === id));
    ({ rows, weekly, overlap } = await compareChannels(ids));
  }
  const ordered = ids.map((id) => rows.find((r) => r.id === id)!).filter(Boolean);
  const health = new Map(await Promise.all(ordered.map(async (r) => [r.id, await channelHealth(r.id).catch(() => null)] as const)));
  const name = (id: string) => rows.find((r) => r.id === id)?.title ?? all.find((c) => c.id === id)?.title ?? id;
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-4);
    return "/compare?" + next.map((x) => `c=${encodeURIComponent(x)}`).join("&");
  };

  const metrics: [string, (r: (typeof ordered)[number]) => string][] = [
    ["Health score", (r) => { const h = health.get(r.id); return h?.score != null ? `${h.score} · ${h.grade}` : "–"; }],
    ["Subscribers", (r) => compact(r.subscriber_count)],
    ["Total views", (r) => compact(r.view_count)],
    ["Videos tracked", (r) => compact(r.videos)],
    ["Comments stored", (r) => compact(r.comments)],
    ["Comments per video", (r) => (r.comments_per_video ? compact(r.comments_per_video) : "–")],
    ["Sentiment score", (r) => score(r.avg_sentiment)],
    ["Negative share", (r) => (r.negative_pct != null ? `${r.negative_pct.toFixed(1)}%` : "–")],
    ["Questions asked", (r) => compact(r.questions)],
    ["Content requests", (r) => compact(r.requests)],
    ["Read by AI", (r) => (r.ai_pct != null ? `${r.ai_pct.toFixed(0)}%` : "–")],
  ];

  return (
    <>
      <PageHeader eyebrow="Compare" title={<>Creators <span className="glow-text">side by side</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Pick up to 4 channels. Sentiment, growth, what viewers ask for, and how many people comment on both.</p>
      </PageHeader>
      {all.length < 2 && ordered.length < 2 ? <Empty>Add at least two channels on the Manage page to compare them.</Empty> : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {all.map((c) => {
              const i = ids.indexOf(c.id);
              return (
                <Link key={c.id} href={toggle(c.id)} scroll={false}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] transition ${i >= 0 ? "border-line-2 bg-white/[0.06] text-ink" : "border-line text-ink-3 hover:text-ink-2"}`}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: i >= 0 ? SERIES[i] : "transparent", border: i >= 0 ? "none" : "1px solid #7c869b" }} />
                  {c.title}
                </Link>
              );
            })}
          </div>

          <Reveal>
            <Panel title="Key numbers">
              <div className="scrollbar-thin -mx-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-[13.5px]">
                  <thead>
                    <tr><th className="label px-2 py-2 text-left font-normal">Metric</th>
                      {ordered.map((r, i) => (
                        <th key={r.id} className="px-2 py-2 text-right font-medium text-ink">
                          <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: SERIES[i] }} />{r.title}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map(([label, fn]) => (
                      <tr key={label} className="border-t border-line">
                        <td className="px-2 py-2.5 text-ink-2">{label}</td>
                        {ordered.map((r) => <td key={r.id} className="px-2 py-2.5 text-right tabular text-ink">{fn(r)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </Reveal>

          <Reveal delay={0.05} className="mt-4">
            <Panel title="Sentiment week by week" subtitle="Average score of each week's comments, −100 … +100 (weeks with fewer than 5 comments are skipped)">
              {weekly.length ? <CompareChart data={weekly} channels={ordered.map((r) => ({ id: r.id, title: r.title }))} /> : <Empty>Not enough analysed comments yet.</Empty>}
            </Panel>
          </Reveal>

          {overlap.length > 0 && (
            <Reveal delay={0.1} className="mt-4">
              <Panel title="Shared audience" subtitle="People who commented on both channels">
                <ul className="space-y-3">
                  {overlap.map((o) => (
                    <li key={o.a + o.b} className="flex flex-wrap items-center gap-3 text-[13.5px]">
                      <span className="text-ink">{name(o.a)}</span><span className="text-ink-3">&amp;</span><span className="text-ink">{name(o.b)}</span>
                      <span className="ml-auto tabular text-ink">{o.shared.toLocaleString("en")} people</span>
                      <span className="w-full text-[12px] text-ink-3 sm:w-auto">{(o.jaccard * 100).toFixed(1)}% of their combined commenters</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </Reveal>
          )}
        </>
      )}
    </>
  );
}
