import Link from "next/link";
import { within } from "@/lib/cache";
import { outlierData, type OutlierData } from "@/lib/outliers";
import { BANDS, bandCounts, patterns, type Kind, type Scored } from "@/lib/outlier-math";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { ago, compact } from "@/lib/format";

export const metadata = { title: "Outliers" };

type Q = { period?: string; min?: string; format?: string; who?: string };
const PERIODS = [{ k: "30", label: "30 days" }, { k: "90", label: "90 days" }, { k: "365", label: "1 year" }, { k: "all", label: "All time" }];
const MINS = ["2", "3", "5", "10"];
const FORMATS: { k: string; label: string; kinds: Kind[] }[] = [
  { k: "all", label: "Everything", kinds: ["short", "long", "reel", "post"] }, { k: "long", label: "Long videos", kinds: ["long"] },
  { k: "short", label: "Shorts", kinds: ["short"] }, { k: "ig", label: "Instagram", kinds: ["reel", "post"] },
];
const WHO = [{ k: "all", label: "Whole niche" }, { k: "mine", label: "My channels" }, { k: "rivals", label: "Competitors" }];
const KIND_LABEL: Record<Kind, string> = { short: "Short", long: "Video", reel: "Reel", post: "Post" };
const times = (x: number) => (x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`);
/** Ring colour by strength: cyan → violet → gold for the biggest hits. */
const ringOf = (s: number) => (s >= 10 ? "#fab219" : s >= 5 ? "#8b7cf6" : "#22d3ee");

export default async function OutliersPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const period = PERIODS.find((p) => p.k === q.period)?.k ?? "90";
  const min = MINS.includes(q.min ?? "") ? Number(q.min) : 3;
  const format = FORMATS.find((f) => f.k === q.format) ?? FORMATS[0];
  const who = WHO.find((w) => w.k === q.who)?.k ?? "all";
  const data: OutlierData = await within(outlierData(), 15_000, { scored: [], channels: [] });
  const header = (
    <PageHeader eyebrow="Outliers · your niche" title={<>Niche <span className="glow-text">outlier finder</span></>}>
      <p className="max-w-2xl text-[15px] text-ink-2">Every upload from every channel you track (yours and competitors, YouTube and Instagram), measured
        against <em>its own channel&apos;s normal</em>: the median of that channel&apos;s previous 20 uploads of the same kind. A 5× video did five
        times what that channel usually gets, so small and big channels compare fairly.</p>
    </PageHeader>
  );
  if (!data.scored.length) return <>{header}<Empty>Not enough videos yet: each channel needs a few uploads of a kind before they can be compared.</Empty></>;

  const chan = new Map(data.channels.map((c) => [c.id, c]));
  const inScope = data.scored.filter((v) => {
    const c = chan.get(v.channel_id);
    if (!c || !format.kinds.includes(v.kind)) return false;
    if (who === "mine" && c.role === "competitor") return false;
    if (who === "rivals" && c.role !== "competitor") return false;
    return period === "all" || v.age <= Number(period);
  });
  const hits = inScope.filter((v) => v.score >= min).sort((a, b) => b.score - a.score);
  const shown = hits.slice(0, 36);
  const bands = bandCounts(inScope);
  const maxBand = Math.max(1, ...bands);
  const traits = patterns(inScope, hits);
  const best = hits[0];
  const rate = inScope.length ? hits.length / inScope.length : 0;
  const link = (patch: Partial<Q>) => {
    const p = new URLSearchParams({ period, min: String(min), format: format.k, who, ...patch } as Record<string, string>);
    return `/outliers?${p}`;
  };

  return (
    <>
      {header}

      {/* Filters */}
      <Reveal>
        <div className="panel mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 p-4 text-[13px]">
          <Filter label="When" items={PERIODS.map((p) => ({ label: p.label, href: link({ period: p.k }), on: p.k === period }))} />
          <Filter label="At least" items={MINS.map((m) => ({ label: `${m}×`, href: link({ min: m }), on: Number(m) === min }))} />
          <Filter label="Format" items={FORMATS.map((f) => ({ label: f.label, href: link({ format: f.k }), on: f.k === format.k }))} />
          <Filter label="Who" items={WHO.map((w) => ({ label: w.label, href: link({ who: w.k }), on: w.k === who }))} />
        </div>
      </Reveal>

      {/* Hero numbers */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Reveal><div className="panel holo relative overflow-hidden p-6">
          <div className="label">Breakouts found</div>
          <div className="mt-2 font-[family-name:var(--font-display)] text-5xl font-semibold glow-text tabular">{hits.length}</div>
          <p className="mt-1 text-[12.5px] text-ink-3">{min}× or more, out of {compact(inScope.length)} uploads</p>
          <div className="scanline pointer-events-none absolute inset-0 opacity-40" />
        </div></Reveal>
        <Reveal delay={0.05}><div className="panel holo p-6">
          <div className="label">Hit rate</div>
          <div className="mt-2 font-[family-name:var(--font-display)] text-5xl font-semibold tabular text-ink">{(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%</div>
          <p className="mt-1 text-[12.5px] text-ink-3">of uploads beat their channel&apos;s normal by {min}×</p>
        </div></Reveal>
        <Reveal delay={0.1}><div className="panel holo p-6">
          <div className="label">Biggest breakout</div>
          {best ? (<>
            <div className="mt-2 font-[family-name:var(--font-display)] text-5xl font-semibold tabular" style={{ color: ringOf(best.score) }}>{times(best.score)}</div>
            <p className="mt-1 truncate text-[12.5px] text-ink-3">{chan.get(best.channel_id)?.title} · {compact(best.view_count ?? 0)} views</p>
          </>) : <p className="mt-3 text-[13px] text-ink-3">None at {min}× in this view.</p>}
        </div></Reveal>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        {/* Distribution */}
        <Reveal className="lg:col-span-2"><Panel title="How uploads land" subtitle="Each upload's views as a multiple of its channel's normal">
          <div className="flex h-44 items-end gap-2">
            {bands.map((n, i) => {
              const hot = BANDS[i].min >= min;
              return (
                <div key={BANDS[i].label} className="flex h-full flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] tabular text-ink-3">{n}</span>
                  <div className="relative w-full flex-1">
                    <div className="grow-y absolute inset-x-0 bottom-0 rounded-t-md" style={{ height: `${Math.max(3, (n / maxBand) * 100)}%`, animationDelay: `${i * 70}ms`,
                      background: hot ? "linear-gradient(to top, rgba(139,124,246,.35), #22d3ee)" : "rgba(255,255,255,.12)",
                      boxShadow: hot ? "0 0 18px -4px #22d3ee" : undefined }} />
                  </div>
                  <span className={`text-[10.5px] ${hot ? "text-accent" : "text-ink-3"}`}>{BANDS[i].label}</span>
                </div>
              );
            })}
          </div>
        </Panel></Reveal>

        {/* Patterns */}
        <Reveal delay={0.05} className="lg:col-span-3"><Panel title="What the breakouts share" subtitle="Traits far more common among breakouts than among all uploads in this view">
          {traits.length ? (
            <ul className="space-y-3">
              {traits.map((t, i) => (
                <li key={t.label}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-ink">{t.label} <span className="text-[11px] uppercase tracking-wider text-ink-3">· {t.group}</span></span>
                    <span className="shrink-0 tabular text-accent">{t.ratio.toFixed(1)}× more common</span>
                  </div>
                  <div className="mt-1.5 grid gap-1">
                    <Bar value={t.inOutliers} color="linear-gradient(90deg,#8b7cf6,#22d3ee)" delay={i * 80} label={`${Math.round(t.inOutliers * 100)}% of breakouts`} />
                    <Bar value={t.inAll} color="rgba(255,255,255,.18)" delay={i * 80 + 40} label={`${Math.round(t.inAll * 100)}% of all uploads`} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>{hits.length >= 3 ? "No single trait stands out among these breakouts yet." : "Needs at least 3 breakouts in this view to compare."}
            {" "}Try a lower multiple or a longer period.</Empty>}
        </Panel></Reveal>
      </div>

      {/* Gallery */}
      <Reveal delay={0.05} className="mt-4"><Panel title="The breakouts" subtitle={`Biggest first${hits.length > shown.length ? ` · top ${shown.length} of ${hits.length}` : ""}`}>
        {shown.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((v) => <Card key={v.id} v={v} channel={chan.get(v.channel_id)?.title ?? ""} rival={chan.get(v.channel_id)?.role === "competitor"} />)}
          </div>
        ) : <Empty>No uploads at {min}× in this view.</Empty>}
      </Panel></Reveal>
    </>
  );
}

function Filter({ label, items }: { label: string; items: { label: string; href: string; on: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="label mr-1">{label}</span>
      {items.map((i) => (
        <Link key={i.label} href={i.href} scroll={false}
          className={`rounded-full px-3 py-1 ring-1 transition ${i.on ? "bg-accent/15 text-accent ring-accent/40 shadow-[0_0_14px_-4px_#22d3ee]" : "text-ink-2 ring-white/10 hover:ring-accent/30"}`}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

function Bar({ value, color, delay, label }: { value: number; color: string; delay: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="grow-x h-full rounded-full" style={{ width: `${Math.max(2, value * 100)}%`, background: color, animationDelay: `${delay}ms` }} />
      </div>
      <span className="w-36 shrink-0 text-right text-[11px] tabular text-ink-3">{label}</span>
    </div>
  );
}

function Card({ v, channel, rival }: { v: Scored; channel: string; rival: boolean }) {
  const ring = ringOf(v.score);
  const p = Math.min(100, (Math.log10(v.score) / Math.log10(30)) * 100);
  return (
    <Link href={`/videos/${v.id}`} className="tilt panel group relative block overflow-hidden p-0">
      <div className="relative aspect-video overflow-hidden bg-black">
        {v.thumbnail_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={v.thumbnail_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-90 transition duration-500 group-hover:scale-105 group-hover:opacity-100" />
          : <div className="grid h-full place-items-center text-ink-3">{KIND_LABEL[v.kind]}</div>}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#05070d] via-transparent to-transparent" />
        <div className="score-ring absolute right-3 top-3 grid h-14 w-14 place-items-center rounded-full font-[family-name:var(--font-display)] text-[15px] font-semibold"
          style={{ "--p": p, "--ring": ring, color: ring } as React.CSSProperties}>{times(v.score)}</div>
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-ink-2 ring-1 ring-white/15 backdrop-blur">
          {KIND_LABEL[v.kind]}{rival ? " · rival" : ""}</span>
      </div>
      <div className="p-4">
        <div className="line-clamp-2 text-[13.5px] font-medium text-ink">{v.title}</div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px] text-ink-3">
          <span className="truncate">{channel}</span><span className="shrink-0">{ago(v.published_at)}</span>
        </div>
        <div className="mt-2 flex gap-4 text-[12px] tabular">
          <span className="text-ink">{compact(v.view_count ?? 0)} <span className="text-ink-3">views</span></span>
          <span className="text-ink-3">normal {compact(v.normal)}</span>
        </div>
      </div>
    </Link>
  );
}
