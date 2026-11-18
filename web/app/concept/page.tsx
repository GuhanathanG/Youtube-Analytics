import Link from "next/link";
import { within } from "@/lib/cache";
import { overviewDaily } from "@/lib/panels";
import { channels as getChannels, kpis } from "@/lib/queries";
import { channelHealth } from "@/lib/creator-insights";
import { movesFor } from "@/lib/recommendations";
import { particleSample } from "@/lib/concept";
import { InView, Words } from "@/components/signal/InView";
import { Decode } from "@/components/signal/Decode";
import { PulseOrb } from "@/components/signal/PulseOrb";
import { Waveform } from "@/components/signal/Waveform";
import { ParticleField } from "@/components/signal/ParticleField";
import { TickRing } from "@/components/signal/TickRing";
import { MiniLine, Rail } from "@/components/signal/Bits";

export const dynamic = "force-dynamic";

const HUBS = [["Pulse", "/"], ["Audience", "/comments"], ["Performance", "/analytics"], ["Market", "/outliers"], ["Create", "/studio"]] as const;
const SECTIONS = [{ id: "pulse", label: "Pulse" }, { id: "numbers", label: "Numbers" }, { id: "conversation", label: "Conversation" },
  { id: "move", label: "Next move" }, { id: "comments", label: "Every comment" }];

function Head({ n, label, title, children }: { n: number; label: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="section-head grid gap-6 md:grid-cols-[1fr_minmax(0,380px)] md:items-end md:gap-16">
      <div>
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ {String(n).padStart(2, "0")} / 04 · {label}</div>
        <h2 className="display mt-5 max-w-[14ch] text-[32px] md:text-[48px]"><Words text={title} /></h2>
      </div>
      {children && <p className="rise text-[15px] leading-relaxed" style={{ color: "var(--ink-2)", transitionDelay: "250ms" }}>{children}</p>}
    </div>
  );
}

export default async function Concept() {
  const allChs = await within(getChannels(), 10_000, []);
  const active = allChs.filter((c) => c.active);
  const heroId = active.find((c) => c.role !== "competitor")?.id ?? null;
  const [k, daily, dots, health, top] = await Promise.all([
    within(kpis(), 10_000, { channels: 0, videos: 0, comments: 0, analyzed: 0, ai_read: 0, videos_backfilling: 0, last_fetch: null, quota_used_today: 0, comments_24h: 0 }),
    within(overviewDaily("90"), 12_000, []),
    within(particleSample(6000), 12_000, []),
    heroId ? within(channelHealth(heroId), 5000, null) : Promise.resolve(null),
    heroId ? within(movesFor(heroId), 5000, null) : Promise.resolve(null),
  ]);
  const heroCh = active.find((c) => c.id === heroId);
  const analysed = active.reduce((s, c) => s + c.positive + c.neutral + c.negative, 0);
  const mood = analysed ? active.reduce((s, c) => s + (c.avg_sentiment ?? 0) * (c.positive + c.neutral + c.negative), 0) / analysed : 0;
  const maxC = Math.max(1, ...active.map((c) => c.comments));
  const sats = active.map((c) => ({ id: c.id, title: c.title, thumb: c.thumbnail_url, weight: Math.sqrt(c.comments / maxC), mood: c.avg_sentiment ?? 0 }));
  const totals = daily.map((d) => d.positive + d.neutral + d.negative);
  const moodLine = daily.map((d) => { const n = d.positive + d.neutral + d.negative; return n ? (d.positive - d.negative) / n : 0; });
  const chNames = Object.fromEntries(active.map((c) => [c.id, c.title]));
  const move = top?.moves[0];
  const kpi = [
    { i: "0001", label: "Comments captured", value: k.comments, format: "int" as const, note: `+${k.comments_24h.toLocaleString("en")} in 24 h`, line: totals, color: "#22e1ff" },
    { i: "0010", label: "Audience mood", value: Math.round(mood * 100), format: "signed" as const, note: "−100 … +100, all channels", line: moodLine, color: "#22e1ff" },
    { i: "0011", label: "Read by AI", value: k.comments ? (k.ai_read / k.comments) * 100 : 0, format: "pct" as const, note: `${k.ai_read.toLocaleString("en")} deep-read`, line: [], color: "#ff3d7f" },
    { i: "0100", label: "Videos tracked", value: k.videos, format: "int" as const, note: `${active.length} channels watched`, line: [], color: "#ededea" },
  ];

  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: "var(--hair)", background: "rgba(7,7,10,.78)", backdropFilter: "blur(14px)" }}>
        <div className="wrap flex h-14 items-center justify-between gap-4">
          <Link href="/concept" className="flex items-baseline gap-2">
            <span className="display text-[19px]">creator<span style={{ color: "var(--cyan)" }}>·</span>pulse</span>
            <span className="mono hidden sm:inline" style={{ fontSize: 9.5 }}>signal r0</span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {HUBS.map(([l, h]) => <Link key={l} href={h} className="text-[13px] transition hover:text-[var(--cyan)]" style={{ color: l === "Pulse" ? "var(--ink)" : "var(--ink-3)" }}>{l}</Link>)}
          </nav>
          <div className="flex items-center gap-3">
            <span className="mono hidden items-center gap-2 sm:flex" style={{ fontSize: 10 }}><i className="live" /> live</span>
            <Link href="/" className="pill pill-solid" style={{ padding: "7px 14px", fontSize: 12 }}><span className="sq" /> Current site</Link>
          </div>
        </div>
      </header>
      <Rail items={SECTIONS} />

      <main>
        {/* 00 Pulse */}
        <InView as="section" id="pulse" className="wrap grid min-h-[calc(100vh-56px)] items-center gap-16 py-20 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <div className="min-w-0" style={{ containerType: "inline-size" }}>
            <div className="mono rise" style={{ color: "var(--cyan)" }}>■ 00 / 04 · Audience pulse</div>
            {/* Sized to the column (container units), so a 9-digit count always fits on a phone and beside the orb. */}
            <h1 className="display mt-5" style={{ fontSize: "min(12.6cqw, 104px)" }}>
              <Decode value={k.comments} className="block" /><Words text="voices." />
            </h1>
            <p className="rise mt-8 max-w-md text-[16px] leading-relaxed" style={{ color: "var(--ink-2)", transitionDelay: "300ms" }}>
              Every comment across {active.length} channels, read and scored. {k.comments_24h.toLocaleString("en")} arrived in the last 24 hours. The core beats faster when they do.
            </p>
            <div className="rise mt-10 flex flex-wrap gap-3" style={{ transitionDelay: "450ms" }}>
              <a href="#comments" className="pill pill-solid"><span className="sq" /> See every comment</a>
              <a href="#move" className="pill pill-line">Today&apos;s move</a>
            </div>
          </div>
          <div className="rise min-w-0" style={{ transitionDelay: "200ms" }}><PulseOrb perDay={k.comments_24h} satellites={sats} /></div>
        </InView>

        {/* Ticker */}
        <div className="ticker border-y py-4" style={{ borderColor: "var(--hair)" }}>
          <div className="ticker-track">
            {[0, 1].map((rep) => (
              <div key={rep} className="flex shrink-0" aria-hidden={rep === 1}>
                {dots.slice(0, 24).map((d, i) => (
                  <span key={i} className="flex shrink-0 items-center gap-3 px-6 text-[13px]" style={{ color: "var(--ink-2)" }}>
                    <span className="sq" style={{ color: d.s === "positive" ? "var(--cyan)" : d.s === "negative" ? "var(--magenta)" : "var(--neutral)" }} />
                    <span className="mono" style={{ fontSize: 9.5 }}>{chNames[d.ch] ?? ""}</span>
                    <span className="max-w-[340px] truncate">{d.text}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 01 Numbers */}
        <InView as="section" id="numbers" className="wrap section">
          <Head n={1} label="Numbers" title="The audience, in four numbers.">Each number decodes, then counts up to the live value. Lines draw the last 90 days.</Head>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4">
            {kpi.map((x, i) => (
              <div key={x.label} className="cell cell-hover min-w-0 p-7 md:p-9" style={{ transitionDelay: `${i * 90}ms`, containerType: "inline-size" }}>
                <div className="mono flex justify-between" style={{ fontSize: 10 }}><span style={{ color: "var(--cyan)" }}>{x.i}</span><span>{x.label}</span></div>
                <div className="display mt-6 whitespace-nowrap md:mt-10" style={{ color: i === 0 ? "var(--ink)" : x.color, fontSize: "min(44px, 12.5cqw)" }}><Decode value={x.value} format={x.format} delay={i * 120} /></div>
                <div className="mt-2 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{x.note}</div>
                <div className="mt-6 md:mt-8"><MiniLine values={x.line} color={x.color} delay={500 + i * 120} /></div>
              </div>
            ))}
          </div>
        </InView>

        {/* 02 Conversation */}
        <InView as="section" id="conversation" className="wrap section">
          <Head n={2} label="Conversation" title="Ninety days, heard like a track.">Positive and neutral comments rise above the line, negative ones hang below. The white line is total volume. Hover any day.</Head>
          <div className="cell p-6 md:p-10"><Waveform days={daily.slice(-90)} /></div>
          <div className="mt-16 grid gap-x-16 gap-y-9 md:grid-cols-2">
            {active.filter((c) => c.positive + c.neutral + c.negative > 0).map((c) => {
              const n = c.positive + c.neutral + c.negative;
              return (
                <div key={c.id}>
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <Link href={`/channels/${c.id}`} className="truncate text-[14px] hover:text-[var(--cyan)]">{c.title}{c.role === "competitor" && <span className="mono ml-2" style={{ fontSize: 9 }}>rival</span>}</Link>
                    <span className="mono" style={{ fontSize: 10 }}>{n.toLocaleString("en")} · <span style={{ color: "var(--cyan)" }}>{Math.round((c.positive / n) * 100)}%</span> / <span style={{ color: "var(--magenta)" }}>{Math.round((c.negative / n) * 100)}%</span></span>
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

        {/* 03 Today's move */}
        <InView as="section" id="move" className="wrap section">
          <Head n={3} label="Next move" title="One thing worth doing today." />
          <div className="cell grid items-center gap-12 p-8 md:grid-cols-[auto_1fr] md:gap-16 md:p-16">
            <div className="flex justify-center"><TickRing value={health?.score ?? 0} label="Health" sub={health?.grade ?? "measuring"} size={200} /></div>
            <div>
              <div className="mono rise" style={{ color: "var(--magenta)" }}>✦ {heroCh?.title ?? "Your channel"} · impact {"■".repeat(move?.impact ?? 1)}{"□".repeat(3 - (move?.impact ?? 1))}</div>
              <h3 className="display mt-5 text-[28px] md:text-[40px]"><Words text={move?.title ?? "All clear for now"} /></h3>
              <p className="rise mt-5 max-w-xl text-[15px] leading-relaxed" style={{ color: "var(--ink-2)", transitionDelay: "300ms" }}>{move?.why ?? "Nothing urgent. New comments and uploads update this live."}</p>
              <div className="rise mt-9 flex flex-wrap gap-3" style={{ transitionDelay: "450ms" }}>
                {move && <Link href={move.href} className="pill pill-solid"><span className="sq" /> {move.cta}</Link>}
                <Link href="/command" className="pill pill-line">All {top?.moves.length ?? 0} moves</Link>
              </div>
            </div>
          </div>
        </InView>

        {/* 04 Every comment */}
        <InView as="section" id="comments" className="wrap section">
          <Head n={4} label="Every comment" title={`${dots.length.toLocaleString("en")} comments. One dot each.`}>
            The newest comments, coloured by mood. Pick a lens and they fly into place. Hover or tap a dot to read it.
          </Head>
          <div className="cell p-5 md:p-10"><ParticleField dots={dots} channels={chNames} /></div>
        </InView>
      </main>

      <footer className="wrap overflow-hidden border-t pb-10 pt-24" style={{ borderColor: "var(--hair)" }}>
        <div className="wordmark select-none text-[17vw] md:text-[13vw]" aria-hidden>pulse<span style={{ color: "var(--cyan)" }}>.</span></div>
        <div className="mono mt-6 flex flex-wrap justify-between gap-3" style={{ fontSize: 10 }}>
          <span>Creator Pulse · Signal concept R0</span><span>Live data · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
        </div>
      </footer>
    </>
  );
}
