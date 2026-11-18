import Link from "next/link";
import { Suspense } from "react";
import { within } from "@/lib/cache";
import { focusChannel } from "@/lib/focus";
import { channels as getChannels } from "@/lib/queries";
import { dailyBrief, movesFor } from "@/lib/recommendations";
import type { Move } from "@/lib/moves";
import { Empty } from "@/components/ui";
import { compact } from "@/lib/format";
import { InView, Words } from "@/components/signal/InView";
import { TickRing } from "@/components/signal/TickRing";
import { Pill, SigHead } from "@/components/signal/Head";

export const metadata = { title: "Command Center" };

const KIND: Record<Move["kind"], { label: string; glyph: string }> = {
  audience: { label: "Audience", glyph: "◉" }, content: { label: "Content", glyph: "▶" }, packaging: { label: "Packaging", glyph: "◧" },
  timing: { label: "Timing", glyph: "◷" }, growth: { label: "Growth", glyph: "↗" }, community: { label: "Community", glyph: "❖" }, fix: { label: "Fix", glyph: "⚑" },
};
const LEVEL = ["", "low", "medium", "high"];

export default async function CommandPage() {
  const chs = (await getChannels()).filter((c) => c.active);
  const focus = await focusChannel(chs.map((c) => c.id));
  const ch = chs.find((c) => c.id === focus) ?? chs[0];
  if (!ch) return (<div className="sig"><h1 className="display text-[36px]">Your next moves</h1><div className="mt-6"><Empty>Add a channel on the Manage page first.</Empty></div></div>);
  return (
    <div className="sig">
      <InView as="section" className="sec">
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ Command center · {ch.title}</div>
        <h1 className="display mt-5 text-[38px] md:text-[56px]"><Words text="Your next moves." /></h1>
        <p className="rise lede mt-6" style={{ transitionDelay: "300ms" }}>Everything Creator Pulse knows about {ch.title}: comments in every language, questions, outliers,
          timing and trends, turned into a short list of next moves with the evidence behind each.</p>
      </InView>
      <Suspense fallback={<div className="panel h-64 animate-pulse" aria-busy="true" />}>
        <Moves id={ch.id} title={ch.title} subs={ch.subscriber_count} comments={ch.comments} />
      </Suspense>
    </div>
  );
}

async function Moves({ id, title, subs, comments }: { id: string; title: string; subs: number | null; comments: number }) {
  const { moves, health } = await within(movesFor(id), 20_000, { moves: [], health: null });
  const brief = await within(dailyBrief(id, title, moves, health).catch(() => null), 6000, null);
  const meter = (v: number, color: string) => (
    <span className="flex gap-[3px]" aria-hidden>{[1, 2, 3].map((i) => <i key={i} className="block h-2.5 w-2.5" style={{ background: i <= v ? color : "rgba(255,255,255,.1)", boxShadow: i <= v ? `0 0 8px ${color}` : undefined }} />)}</span>
  );
  return (
    <>
      <InView as="section" className="sec">
        <SigHead n={1} of={2} label="AI brief" title={brief?.headline ?? (moves[0] ? moves[0].title : "All clear for now")} />
        <div className="cell grid items-center gap-10 p-7 md:grid-cols-[auto_1fr] md:gap-14 md:p-10">
          <div className="flex justify-center"><TickRing value={health?.score ?? 0} label="Health" sub={health?.grade ?? "measuring"} size={196}
            color={(health?.score ?? 0) >= 70 ? "#22e1ff" : (health?.score ?? 0) >= 45 ? "#ededea" : "#ff3d7f"} /></div>
          <div className="min-w-0">
            <div className="mono rise" style={{ color: "var(--magenta)" }}>✦ AI brief</div>
            <p className="rise lede mt-4" style={{ transitionDelay: "200ms" }}>
              {brief?.brief ?? (moves.length ? `${moves.length} moves ranked by impact and effort. Start with the first.` : "Nothing urgent. Check back after new comments arrive.")}
            </p>
            <div className="rise mt-7 grid max-w-xl grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4" style={{ transitionDelay: "350ms" }}>
              {([["Grade", health?.grade ?? "—"], ["Subscribers", compact(subs)], ["Comments read", compact(comments)], ["Moves", String(moves.length)]] as const).map(([l, v]) => (
                <div key={l}><div className="mono" style={{ fontSize: 9.5 }}>{l}</div><div className="display mt-1.5 text-[20px]">{v}</div></div>
              ))}
            </div>
          </div>
        </div>
      </InView>

      <InView as="section" className="sec">
        <SigHead n={2} of={2} label="Moves" title={`${moves.length} next moves, ranked.`}>
          Highest impact for the least effort first. Each one shows the evidence it comes from and a button to act on it.
        </SigHead>
        {moves.length === 0 ? <Empty>No moves yet: they appear once there are enough videos and comments to learn from.</Empty> : (
          <ol className="grid lg:grid-cols-2">
            {moves.map((m, k) => (
              <li key={m.id} className="cell cell-hover flex h-full flex-col p-6 md:p-8" style={{ transitionDelay: `${Math.min(k * 60, 400)}ms` }}>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <span className="display text-[30px] leading-none" style={{ color: k === 0 ? "var(--cyan)" : "var(--ink-3)" }}>{String(k + 1).padStart(2, "0")}</span>
                  <span className="mono" style={{ fontSize: 10 }}>{KIND[m.kind].glyph} {KIND[m.kind].label}</span>
                  <span className="mono flex items-center gap-2" style={{ fontSize: 10 }}>impact {LEVEL[m.impact]} {meter(m.impact, "#22e1ff")}</span>
                  <span className="mono flex items-center gap-2" style={{ fontSize: 10 }}>effort {LEVEL[m.effort]} {meter(m.effort, "#8a8a93")}</span>
                </div>
                <h3 className="display mt-5 text-[21px] md:text-[23px]">{m.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{m.why}</p>
                <ul className="mt-4 space-y-1.5">
                  {m.evidence.map((e) => (
                    <li key={e} className="flex gap-2.5 text-[13.5px]" style={{ color: "var(--ink-3)" }}><span className="mt-[8px] h-1 w-1 shrink-0 bg-[var(--cyan)]" />{e}</li>
                  ))}
                </ul>
                <div className="mt-auto pt-6"><Pill href={m.href} solid={k === 0}>{m.cta} →</Pill></div>
              </li>
            ))}
          </ol>
        )}
      </InView>
    </>
  );
}
