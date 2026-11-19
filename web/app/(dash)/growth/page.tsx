import Link from "next/link";
import { within } from "@/lib/cache";
import { channels as getChannels } from "@/lib/queries";
import { goals as getGoals, METRICS, titleChanges, type Change, type Goal } from "@/lib/growth";
import { addGoalAction, deleteGoalAction } from "@/app/actions";
import { Empty, Panel } from "@/components/ui";
import { InView, Words } from "@/components/signal/InView";
import { SigHead } from "@/components/signal/Head";
import { TickRing } from "@/components/signal/TickRing";
import { ago, compact } from "@/lib/format";
import { GoalTrack } from "@/components/viz";

export const metadata = { title: "Growth" };

const fmtDate = (days: number) => new Date(Date.now() + days * 86400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const ringColor = (g: Goal) => (g.view.reached ? "#ededea" : g.view.onTrack === false ? "#ff3d7f" : "#22e1ff");

export default async function GrowthPage() {
  const [chs, list, changes] = await Promise.all([getChannels(), within(getGoals(), 8000, [] as Goal[]), within(titleChanges(), 8000, [] as Change[])]);
  const mine = chs.filter((c) => c.active);

  return (
    <div className="sig">
      <InView as="section" className="sec">
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ Growth · goals & changes</div>
        <h1 className="display mt-5 text-[38px] md:text-[56px]"><span className="sr-only">Goals, milestones &amp; title changes. </span><Words text="Where you're heading, and when." /></h1>
        <p className="rise lede mt-6" style={{ transitionDelay: "300ms" }}>Set a target and see when you&apos;ll reach it at your current pace (measured from the growth
          snapshots taken through the day), and the pace a deadline needs. Below: every title change on your videos, caught automatically, with views per hour before and after.</p>
      </InView>

      <InView as="section" className="sec">
        <SigHead n={1} of={2} label="Goals" title={list.length ? `${list.length} goal${list.length === 1 ? "" : "s"} in motion.` : "Set your first goal."} />
        <form action={addGoalAction} className="mb-6 grid gap-4 border border-line p-5 text-[13px] sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-end">
          <Field label="Channel"><select name="channel" required className="h-10 rounded-md border border-line-2 bg-[#0b0b10] px-3 text-[14px]">{mine.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
          <Field label="Metric"><select name="metric" className="h-10 rounded-md border border-line-2 bg-[#0b0b10] px-3 text-[14px]">{Object.entries(METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></Field>
          <Field label="Target"><input name="target" required placeholder="e.g. 3M or 3000000" className="h-10 rounded-md border border-line-2 bg-[#0b0b10] px-3 text-[14px]" /></Field>
          <Field label="By (optional)"><input name="deadline" type="date" className="h-10 rounded-md border border-line-2 bg-[#0b0b10] px-3 text-[14px]" /></Field>
          <button className="pill pill-solid justify-center"><span className="sq" /> Add goal</button>
        </form>

        {list.length ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3">
            {list.map((g) => (
              <div key={g.id} className="cell cell-hover relative p-6">
                <div className="flex items-center gap-5">
                  <TickRing value={Math.min(100, g.view.progress * 100)} label="Done" size={108} color={ringColor(g)} />
                  <div className="min-w-0">
                    <div className="mono truncate" style={{ fontSize: 9.5 }}>{g.channel}</div>
                    <div className="display mt-2 text-[22px]">{compact(g.view.target)} {METRICS[g.metric]?.label.toLowerCase()}</div>
                    <div className="mt-1 text-[13px] text-ink-3">now {compact(g.view.current)} · {Math.floor(g.view.progress * 100)}%{g.deadline ? ` · by ${new Date(g.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}</div>
                  </div>
                </div>
                <GoalTrack etaDays={g.view.etaDays} deadline={g.deadline} reached={g.view.reached} />
                <div className="mt-4 space-y-1.5 text-[13.5px]">
                  {g.view.reached ? <p style={{ color: "var(--cyan)" }}>Reached 🎉</p>
                    : g.view.etaDays !== null ? <p className="text-ink">At today&apos;s pace: <span className="text-accent">{fmtDate(g.view.etaDays)}</span> <span className="text-ink-3">({Math.ceil(g.view.etaDays)} days)</span></p>
                    : <p className="text-ink-3">{g.days < 0.5 ? "Measuring the pace: needs half a day of snapshots." : "Not growing in this period, so no date yet."}</p>}
                  {g.view.pace !== null && <p className="text-ink-3">Pace: {g.view.pace >= 0 ? "+" : ""}{compact(Math.round(g.view.pace))} a day <span className="text-[11.5px]">(over {g.days >= 1 ? `${Math.round(g.days)} days` : "the last hours"})</span></p>}
                  {g.view.needPerDay !== null && (
                    <p style={{ color: g.view.onTrack ? "var(--cyan)" : "var(--magenta)" }}>Deadline needs +{compact(Math.round(g.view.needPerDay))} a day: {g.view.onTrack ? "on track" : "behind"}</p>
                  )}
                </div>
                <form action={deleteGoalAction} className="absolute right-3 top-3"><input type="hidden" name="id" value={g.id} />
                  <button aria-label="Remove goal" className="px-2 text-ink-3 hover:text-neg">×</button></form>
              </div>
            ))}
          </div>
        ) : <Empty>No goals yet. Add one above, e.g. 3M subscribers by next year.</Empty>}
      </InView>

      <InView as="section" className="sec">
        <SigHead n={2} of={2} label="Title changes" title="Every rename, and what it did.">
          Caught automatically when a video&apos;s title changes; views per hour in the 48 hours before vs after.
        </SigHead>
        <Panel title="Title changes">
          {changes.length ? (
            <ul className="divide-y divide-line">
              {changes.map((c) => (
                <li key={c.id} className="grid gap-x-6 gap-y-2 py-4 first:pt-0 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] text-ink-3 line-through decoration-[#ff3d7f]/60">{c.old_value}</div>
                    <Link href={`/videos/${c.video_id}`} className="mt-1 block truncate text-[15px] text-ink hover:text-accent">{c.new_value}</Link>
                    <div className="mono mt-1" style={{ fontSize: 9.5 }}>{c.channel} / {ago(c.changed_at)}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-[12px] tabular text-ink-2">{c.before !== null ? `${compact(Math.round(c.before))}/h` : "–"} → {c.after !== null ? `${compact(Math.round(c.after))}/h` : "measuring…"}</span>
                    {c.lift !== null && <span className="display text-[20px] tabular" style={{ color: c.lift >= 1 ? "var(--cyan)" : "var(--magenta)" }}>
                      {c.lift >= 1 ? "+" : "−"}{Math.round(Math.abs(c.lift - 1) * 100)}%</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>No title changes seen yet. When you rename a video, it appears here with its effect on views.</Empty>}
          <p className="mt-4 text-[12.5px] text-ink-3">Thumbnail changes can&apos;t be detected: YouTube keeps the same image address when a thumbnail changes. Views per hour also fall naturally as a video ages, so compare the change against that.</p>
        </Panel>
      </InView>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-2"><span className="label">{label}</span>{children}</label>;
}
