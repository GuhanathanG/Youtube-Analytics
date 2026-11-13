import Link from "next/link";
import { within } from "@/lib/cache";
import { channels as getChannels } from "@/lib/queries";
import { goals as getGoals, METRICS, titleChanges, type Change, type Goal } from "@/lib/growth";
import { addGoalAction, deleteGoalAction } from "@/app/actions";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { ago, compact } from "@/lib/format";
import { GoalTrack } from "@/components/viz";

export const metadata = { title: "Growth" };

const fmtDate = (days: number) => new Date(Date.now() + days * 86400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const ringColor = (g: Goal) => (g.view.reached ? "#0ca30c" : g.view.onTrack === false ? "#fab219" : "#22d3ee");

export default async function GrowthPage() {
  const [chs, list, changes] = await Promise.all([getChannels(), within(getGoals(), 8000, [] as Goal[]), within(titleChanges(), 8000, [] as Change[])]);
  const mine = chs.filter((c) => c.active);

  return (
    <>
      <PageHeader eyebrow="Growth · goals & changes" title={<>Goals, milestones <span className="glow-text">&amp; title changes</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Set a target and see when you&apos;ll reach it at your current pace (measured from the growth
          snapshots taken through the day), and the pace a deadline needs. Below: every title change on your videos, caught automatically, with views per hour before and after.</p>
      </PageHeader>

      <Reveal>
        <form action={addGoalAction} className="panel holo mb-4 flex flex-wrap items-end gap-3 p-4 text-[13px]">
          <Field label="Channel"><select name="channel" required className="input">{mine.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
          <Field label="Metric"><select name="metric" className="input">{Object.entries(METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select></Field>
          <Field label="Target"><input name="target" required placeholder="e.g. 3M or 3000000" className="input w-40" /></Field>
          <Field label="By (optional)"><input name="deadline" type="date" className="input" /></Field>
          <button className="btn-neon rounded-xl px-5 py-2.5 font-medium">Add goal</button>
        </form>
      </Reveal>

      {list.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((g, i) => (
            <Reveal key={g.id} delay={i * 0.04}><div className="panel holo tilt relative p-5">
              <div className="flex items-start gap-4">
                <div className="score-ring grid h-24 w-24 shrink-0 place-items-center rounded-full"
                  style={{ "--p": Math.round(g.view.progress * 100), "--ring": ringColor(g) } as React.CSSProperties}>
                  <span className="font-[family-name:var(--font-display)] text-xl font-semibold tabular" style={{ color: ringColor(g) }}>{Math.floor(g.view.progress * 100)}%</span>
                </div>
                <div className="min-w-0">
                  <div className="label">{g.channel}</div>
                  <div className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold text-ink">{compact(g.view.target)} {METRICS[g.metric]?.label.toLowerCase()}</div>
                  <div className="text-[12.5px] text-ink-3">now {compact(g.view.current)}{g.deadline ? ` · by ${new Date(g.deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}</div>
                </div>
              </div>
              <GoalTrack etaDays={g.view.etaDays} deadline={g.deadline} reached={g.view.reached} />
              <div className="mt-3 space-y-1.5 text-[13px]">
                {g.view.reached ? <p className="text-good">Reached 🎉</p>
                  : g.view.etaDays !== null ? <p className="text-ink">At today&apos;s pace: <span className="text-accent">{fmtDate(g.view.etaDays)}</span> <span className="text-ink-3">({Math.ceil(g.view.etaDays)} days)</span></p>
                  : <p className="text-ink-3">{g.days < 0.5 ? "Measuring the pace: needs half a day of snapshots." : "Not growing in this period, so no date yet."}</p>}
                {g.view.pace !== null && <p className="text-ink-3">Pace: {g.view.pace >= 0 ? "+" : ""}{compact(Math.round(g.view.pace))} a day <span className="text-[11.5px]">(over {g.days >= 1 ? `${Math.round(g.days)} days` : "the last hours"})</span></p>}
                {g.view.needPerDay !== null && (
                  <p className={g.view.onTrack ? "text-good" : "text-warn"}>Deadline needs +{compact(Math.round(g.view.needPerDay))} a day: {g.view.onTrack ? "on track" : "behind"}</p>
                )}
              </div>
              <form action={deleteGoalAction} className="absolute right-3 top-3"><input type="hidden" name="id" value={g.id} />
                <button aria-label="Remove goal" className="rounded-full px-2 text-ink-3 hover:text-neg">×</button></form>
            </div></Reveal>
          ))}
        </div>
      ) : <Empty>No goals yet. Add one above, e.g. 3M subscribers by next year.</Empty>}

      <Reveal delay={0.05} className="mt-6"><Panel title="Title changes" subtitle="Caught automatically when a video's title changes; views per hour in the 48 hours before vs after">
        {changes.length ? (
          <ul className="divide-y divide-line">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-[13px]">
                <div className="min-w-0 flex-1 basis-80">
                  <Link href={`/videos/${c.video_id}`} className="block truncate text-ink hover:text-accent">{c.new_value}</Link>
                  <div className="truncate text-ink-3 line-through decoration-white/20">{c.old_value}</div>
                </div>
                <span className="text-ink-3">{c.channel} · {ago(c.changed_at)}</span>
                <span className="tabular text-ink-2">{c.before !== null ? `${compact(Math.round(c.before))}/h` : "–"} → {c.after !== null ? `${compact(Math.round(c.after))}/h` : "measuring…"}</span>
                {c.lift !== null && <span className={`rounded-full px-2 py-0.5 tabular ring-1 ${c.lift >= 1 ? "bg-good/10 text-good ring-good/30" : "bg-neg/10 text-neg ring-neg/30"}`}>
                  {c.lift >= 1 ? "+" : "−"}{Math.round(Math.abs(c.lift - 1) * 100)}%</span>}
              </li>
            ))}
          </ul>
        ) : <Empty>No title changes seen yet. When you rename a video, it appears here with its effect on views.</Empty>}
        <p className="mt-3 text-[12px] text-ink-3">Thumbnail changes can&apos;t be detected: YouTube keeps the same image address when a thumbnail changes. Views per hour also fall naturally as a video ages, so compare the change against that.</p>
      </Panel></Reveal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="label">{label}</span>{children}</label>;
}
