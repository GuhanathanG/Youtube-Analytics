import Link from "next/link";
import { within } from "@/lib/cache";
import { channels as getChannels } from "@/lib/queries";
import { sideBySide, type Side, type SideBySide } from "@/lib/platforms";
import { SLOTS } from "@/lib/platform-math";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { compact } from "@/lib/format";

export const metadata = { title: "YouTube vs Instagram" };

const YT = "#ff3b4a", IG = "#e1306c", IG2 = "#f77737";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const signed = (x: number | null) => (x === null ? "–" : `${x >= 0 ? "+" : "−"}${compact(Math.abs(Math.round(x)))}`);

export default async function PlatformsPage({ searchParams }: { searchParams: Promise<{ yt?: string; ig?: string }> }) {
  const q = await searchParams;
  const chs = (await getChannels()).filter((c) => c.active);
  const yts = chs.filter((c) => !c.id.startsWith("ig_")), igs = chs.filter((c) => c.id.startsWith("ig_"));
  const ytId = yts.find((c) => c.id === q.yt)?.id ?? yts[0]?.id ?? null;
  const igId = igs.find((c) => c.id === q.ig)?.id ?? igs[0]?.id ?? null;
  const data: SideBySide = await within(sideBySide(ytId, igId), 15_000, { yt: null, ig: null, ideas: [] });
  const { yt, ig } = data;

  return (
    <>
      <PageHeader eyebrow="Platforms · side by side" title={<><span style={{ color: YT }}>YouTube</span> <span className="text-ink-3">vs</span>{" "}
        <span style={{ background: `linear-gradient(90deg, ${IG}, ${IG2})`, WebkitBackgroundClip: "text", color: "transparent" }}>Instagram</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">One channel next to one account: audience and growth, output, reach, engagement, mood, the best
          time to post on each, and what to carry across. &ldquo;How well&rdquo; always means compared with that account&apos;s own normal, so different sizes compare fairly.</p>
      </PageHeader>

      <Reveal>
        <form action="/platforms" className="panel holo mb-5 grid items-end gap-3 p-4 sm:grid-cols-[1fr_auto_1fr_auto]">
          <label className="flex flex-col gap-1"><span className="label" style={{ color: YT }}>YouTube channel</span>
            <select name="yt" defaultValue={ytId ?? ""} className="input">{yts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <span className="hidden pb-2 text-center font-[family-name:var(--font-display)] text-xl text-ink-3 sm:block">VS</span>
          <label className="flex flex-col gap-1"><span className="label" style={{ color: IG }}>Instagram account</span>
            <select name="ig" defaultValue={igId ?? ""} className="input">{igs.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <button className="btn-neon rounded-xl px-5 py-2.5 font-medium">Compare</button>
        </form>
      </Reveal>

      {!yt || !ig ? <Empty>Add at least one YouTube channel and one Instagram account on <Link href="/manage" className="text-accent">Manage</Link>.</Empty> : (
        <>
          {/* Hero: the two accounts facing each other */}
          <Reveal><div className="relative grid gap-4 md:grid-cols-2">
            <Hero s={yt} color={YT} />
            <Hero s={ig} color={IG} color2={IG2} />
            <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line-2 bg-[#05070d] font-[family-name:var(--font-display)] text-lg font-semibold text-ink shadow-[0_0_40px_-6px_#22d3ee] md:grid">VS</div>
          </div></Reveal>

          {/* Head to head */}
          <Reveal delay={0.05} className="mt-4"><Panel title="Head to head" subtitle="The longer bar wins each row">
            <div className="space-y-4">
              <Duel label="Audience" a={yt.audience} b={ig.audience} fmt={compact} />
              <Duel label="Growth, last 30 days" a={yt.growth30} b={ig.growth30} fmt={signed} />
              <Duel label="Uploads, last 30 days" a={yt.posts30} b={ig.posts30} fmt={(x) => String(x ?? "–")} />
              <Duel label="Typical views per upload" a={yt.typicalViews} b={ig.typicalViews} fmt={compact} />
              <Duel label="Engagement (likes + comments per view)" a={yt.engagement} b={ig.engagement} fmt={pct} />
              <Duel label="Hit rate (uploads at 2× normal, 90 days)" a={yt.hitRate} b={ig.hitRate} fmt={pct} />
              <Duel label="Comments, last 30 days" a={yt.sentiment.comments30} b={ig.sentiment.comments30} fmt={compact} />
            </div>
          </Panel></Reveal>

          {/* Mood + momentum */}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[{ s: yt, c: YT }, { s: ig, c: IG }].map(({ s, c }, i) => (
              <Reveal key={s.id} delay={0.05 + i * 0.05}><Panel title={<span>Mood &amp; momentum · <span style={{ color: c }}>{s.platform === "youtube" ? "YouTube" : "Instagram"}</span></span>}
                subtitle="Comment sentiment (30 days) and views of uploads by week (12 weeks)">
                <div className="flex flex-wrap items-center gap-6">
                  <Mood s={s} />
                  <Weekly s={s} color={c} />
                </div>
              </Panel></Reveal>
            ))}
          </div>

          {/* When to post */}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[{ s: yt, c: YT }, { s: ig, c: IG }].map(({ s, c }, i) => (
              <Reveal key={s.id} delay={0.05 + i * 0.05}><Panel title={<span>When to post · <span style={{ color: c }}>{s.platform === "youtube" ? "YouTube" : "Instagram"}</span></span>}
                subtitle={s.best ? `Best so far: ${DAYS[s.best.day]} ${SLOTS[s.best.slot].label.toLowerCase()} (${s.best.score.toFixed(1)}× normal), India time` : "Needs 2+ uploads in a slot (last year)"}>
                <Heat grid={s.grid} color={c} />
              </Panel></Reveal>
            ))}
          </div>

          {/* Repurpose */}
          <Reveal delay={0.05} className="mt-4"><Panel title="Carry it across" subtitle="Recent uploads that broke out on one platform and haven't been tried on the other">
            {data.ideas.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.ideas.map((x) => (
                  <Link key={x.from.id} href={`/videos/${x.from.id}`} className="tilt panel group relative overflow-hidden p-0">
                    <div className="relative aspect-video overflow-hidden bg-black">
                      {x.from.thumbnail_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={x.from.thumbnail_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-90 transition duration-500 group-hover:scale-105" />
                        : null}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#05070d] via-transparent to-transparent" />
                      <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[12px] font-medium">
                        <Pill c={x.to === "youtube" ? IG : YT}>{x.to === "youtube" ? "Instagram" : "YouTube"}</Pill>
                        <span className="anim-flow text-ink">→</span>
                        <Pill c={x.to === "youtube" ? YT : IG}>{x.to === "youtube" ? "YouTube" : "Instagram"}</Pill>
                      </div>
                      <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 font-[family-name:var(--font-display)] text-[13px] text-accent ring-1 ring-accent/40">{x.from.score.toFixed(1)}×</span>
                    </div>
                    <div className="p-4">
                      <div className="line-clamp-2 text-[13.5px] font-medium text-ink">{x.from.title}</div>
                      <div className="mt-1 text-[12px] text-ink-3">{x.why}</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : <Empty>No recent breakouts (2× normal) to carry across yet.</Empty>}
          </Panel></Reveal>
        </>
      )}
    </>
  );
}

function Hero({ s, color, color2 }: { s: Side; color: string; color2?: string }) {
  const grad = color2 ? `linear-gradient(135deg, ${color}, ${color2})` : color;
  return (
    <div className="panel holo relative overflow-hidden p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-25 blur-3xl" style={{ background: grad }} />
      <div className="flex items-center gap-4">
        {s.thumb
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={s.thumb} alt="" className="h-16 w-16 rounded-full object-cover ring-2" style={{ boxShadow: `0 0 30px -4px ${color}` }} referrerPolicy="no-referrer" />
          : <span className="grid h-16 w-16 place-items-center rounded-full text-xl" style={{ background: grad }}>{s.title.slice(0, 1)}</span>}
        <div className="min-w-0">
          <div className="label" style={{ color }}>{s.platform === "youtube" ? "YouTube" : "Instagram"}</div>
          <Link href={`/channels/${s.id}`} className="block truncate font-[family-name:var(--font-display)] text-xl font-semibold text-ink hover:underline">{s.title}</Link>
        </div>
      </div>
      <div className="mt-5 flex items-end gap-6">
        <div>
          <div className="font-[family-name:var(--font-display)] text-4xl font-semibold tabular text-ink">{compact(s.audience)}</div>
          <div className="text-[12px] text-ink-3">{s.platform === "youtube" ? "subscribers" : "followers"}</div>
        </div>
        <div className="pb-1 text-[13px]">
          <span className={(s.growthPerDay ?? 0) >= 0 ? "text-good" : "text-neg"}>{signed(s.growthPerDay)}</span>
          <span className="text-ink-3"> a day</span>
        </div>
      </div>
    </div>
  );
}

/** One comparison row: YouTube bar grows left from the centre, Instagram bar grows right; the winner glows. */
function Duel({ label, a, b, fmt }: { label: string; a: number | null; b: number | null; fmt: (x: number | null) => string }) {
  const max = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0), 1e-9);
  const wa = a === null ? 0 : (Math.abs(a) / max) * 100, wb = b === null ? 0 : (Math.abs(b) / max) * 100;
  const win = a === null || b === null || a === b ? null : a > b ? "a" : "b";
  return (
    <div>
      <div className="mb-1.5 text-center text-[11.5px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center justify-end gap-2">
          <span className={`tabular text-[13px] ${win === "a" ? "font-semibold text-ink" : "text-ink-2"}`}>{fmt(a)}</span>
          <div className="h-2.5 w-full max-w-[320px] overflow-hidden rounded-full bg-white/[0.05]">
            <div className="ml-auto h-full rounded-full grow-x" style={{ width: a === null ? 0 : `${Math.max(1.5, wa)}%`, transformOrigin: "right", background: `linear-gradient(270deg, ${YT}, rgba(255,59,74,.35))`,
              boxShadow: win === "a" ? `0 0 16px -2px ${YT}` : undefined }} />
          </div>
        </div>
        <span className="h-4 w-px bg-line-2" />
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-full max-w-[320px] overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full grow-x" style={{ width: b === null ? 0 : `${Math.max(1.5, wb)}%`, background: `linear-gradient(90deg, ${IG}, ${IG2})`,
              boxShadow: win === "b" ? `0 0 16px -2px ${IG}` : undefined }} />
          </div>
          <span className={`tabular text-[13px] ${win === "b" ? "font-semibold text-ink" : "text-ink-2"}`}>{fmt(b)}</span>
        </div>
      </div>
    </div>
  );
}

function Mood({ s }: { s: Side }) {
  const { positive: p, neutral: n, negative: g } = s.sentiment;
  const total = p + n + g;
  if (!total) return <div className="grid h-28 w-28 place-items-center rounded-full border border-dashed border-line-2 text-center text-[11px] text-ink-3">No comments read yet</div>;
  const a = (p / total) * 100, b = a + (n / total) * 100;
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-28 w-28 rounded-full" style={{ background: `conic-gradient(#3987e5 0 ${a}%, #8a8f9c ${a}% ${b}%, #e66767 ${b}% 100%)`, boxShadow: "0 0 28px -8px #3987e5" }}>
        <div className="absolute inset-3 grid place-items-center rounded-full bg-[#05070d]">
          <span className="font-[family-name:var(--font-display)] text-xl font-semibold tabular text-ink">{Math.round((p / total) * 100)}%</span>
        </div>
      </div>
      <ul className="space-y-1 text-[12px]">
        <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-pos" />positive {Math.round((p / total) * 100)}%</li>
        <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-neu" />neutral {Math.round((n / total) * 100)}%</li>
        <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-neg" />negative {Math.round((g / total) * 100)}%</li>
      </ul>
    </div>
  );
}

function Weekly({ s, color }: { s: Side; color: string }) {
  const max = Math.max(1, ...s.trend.map((w) => w.views));
  if (!s.trend.length) return <p className="text-[12.5px] text-ink-3">No uploads in 12 weeks.</p>;
  return (
    <div className="min-w-[180px] flex-1">
      <div className="flex h-24 items-end gap-1">
        {s.trend.map((w, i) => (
          <div key={w.week} title={`${w.week}: ${compact(w.views)} views`} className="relative h-full flex-1">
            <div className="grow-y absolute inset-x-0 bottom-0 rounded-t" style={{ height: `${Math.max(3, (w.views / max) * 100)}%`, animationDelay: `${i * 50}ms`,
              background: `linear-gradient(to top, ${color}33, ${color})`, boxShadow: i === s.trend.length - 1 ? `0 0 14px -2px ${color}` : undefined }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-ink-3"><span>12 wk ago</span><span>this week</span></div>
    </div>
  );
}

function Heat({ grid, color }: { grid: (number | null)[][]; color: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-separate border-spacing-1 text-[11px]">
        <thead><tr><th />{SLOTS.map((s) => <th key={s.label} className="font-normal text-ink-3">{s.label}</th>)}</tr></thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <td className="pr-1 text-ink-3">{DAYS[d]}</td>
              {row.map((v, i) => {
                const strength = v === null ? 0 : Math.max(0.08, Math.min(1, Math.log2(Math.max(v, 0.25)) / 2 + 0.5));
                return (
                  <td key={i} title={v === null ? "Not enough uploads" : `${v.toFixed(1)}× normal`}
                    className="h-8 rounded-md text-center tabular transition-transform hover:scale-110"
                    style={{ background: v === null ? "rgba(255,255,255,.03)" : `color-mix(in srgb, ${color} ${Math.round(strength * 85)}%, transparent)`,
                      boxShadow: v !== null && v >= 1.5 ? `0 0 12px -3px ${color}` : undefined, color: v !== null && strength > 0.55 ? "#fff" : "var(--color-ink-3)" }}>
                    {v === null ? "" : `${v.toFixed(1)}×`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ c, children }: { c: string; children: React.ReactNode }) {
  return <span className="rounded-full px-2 py-0.5 text-white" style={{ background: c, boxShadow: `0 0 12px -2px ${c}` }}>{children}</span>;
}
