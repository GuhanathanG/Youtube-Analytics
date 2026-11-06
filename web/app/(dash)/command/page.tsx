import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { within } from "@/lib/cache";
import { focusChannel } from "@/lib/focus";
import { channels as getChannels } from "@/lib/queries";
import { dailyBrief, nextMoves } from "@/lib/recommendations";
import type { Move } from "@/lib/moves";
import { RingGauge } from "@/components/RingGauge";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader } from "@/components/ui";
import { compact } from "@/lib/format";

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
  if (!ch) return (<><PageHeader eyebrow="Command Center" title={<>Your <span className="glow-text">next moves</span></>} /><Empty>Add a channel on the Manage page first.</Empty></>);
  return (
    <>
      <PageHeader eyebrow={`Command Center · ${ch.title}`} title={<>Your <span className="glow-text">next moves</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Everything Creator Pulse knows about {ch.title}: comments in every language, questions, outliers,
          timing and trends, turned into a short list of actions with the evidence behind each.</p>
      </PageHeader>
      <Suspense fallback={<div className="panel h-64 animate-pulse" aria-busy="true" />}>
        <Moves id={ch.id} title={ch.title} subs={ch.subscriber_count} comments={ch.comments} />
      </Suspense>
    </>
  );
}

async function Moves({ id, title, subs, comments }: { id: string; title: string; subs: number | null; comments: number }) {
  const { moves, health } = await within(nextMoves(id), 20_000, { moves: [], health: null });
  const brief = await within(dailyBrief(id, title, moves, health).catch(() => null), 6000, null);
  return (
    <>
      <Reveal>
        <section className="panel overflow-hidden p-5 sm:p-7">
          <div className="scanline" aria-hidden />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
            <RingGauge value={health?.score ?? null} label="HEALTH" />
            <div className="min-w-0 flex-1">
              <div className="label flex items-center gap-2 text-accent"><Sparkles size={13} />Today&apos;s brief</div>
              <h2 className="mt-3 font-serif-display text-[28px] leading-[1.15] text-ink sm:text-[34px]">
                {brief?.headline ?? (moves[0] ? moves[0].title : "All clear for now")}
              </h2>
              <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-ink-2">
                {brief?.brief ?? (moves.length ? `${moves.length} moves ranked by impact and effort. Start with the first.` : "Nothing urgent. Check back after new comments arrive.")}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="chip">{health?.grade ?? "—"}</span>
                <span className="chip">{compact(subs)} subs</span>
                <span className="chip">{compact(comments)} comments read</span>
                <span className="chip chip-hi">{moves.length} moves</span>
              </div>
            </div>
          </div>
        </section>
      </Reveal>

      {moves.length === 0 ? <div className="mt-6"><Empty>No moves yet: they appear once there are enough videos and comments to learn from.</Empty></div> : (
        <ol className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {moves.map((m, k) => (
            <li key={m.id} className="group grid gap-4 p-5 transition-colors hover:bg-white/[0.015] sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-start sm:p-7">
              <span className="font-serif-display text-[34px] leading-none text-accent/80 tabular">{String(k + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label">{KIND[m.kind].label}</span>
                  <span className="text-ink-3">·</span>
                  <span className={`text-[11.5px] ${m.impact === 3 ? "text-accent" : "text-ink-2"}`}>{LEVEL[m.impact]} impact</span>
                  <span className="text-ink-3">·</span>
                  <span className="text-[11.5px] text-ink-3">{LEVEL[m.effort]} effort</span>
                </div>
                <h3 className="mt-2 text-[18px] font-medium leading-snug tracking-tight text-ink">{m.title}</h3>
                <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-ink-2">{m.why}</p>
                <ul className="mt-3 space-y-1">
                  {m.evidence.map((e) => (
                    <li key={e} className="flex gap-2.5 text-[12.5px] text-ink-3"><span className="mt-[8px] h-px w-3 shrink-0 bg-accent/60" />{e}</li>
                  ))}
                </ul>
              </div>
              <Link href={m.href} className="btn-ghost justify-self-start whitespace-nowrap sm:mt-1">{m.cta}<ArrowRight size={14} /></Link>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
