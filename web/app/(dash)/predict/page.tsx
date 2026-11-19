import Link from "next/link";
import { within } from "@/lib/cache";
import { focusChannel } from "@/lib/focus";
import { channels as getChannels } from "@/lib/queries";
import { engineFor, forecastsFor } from "@/lib/engine-model";
import { estimateDraft } from "@/lib/whatif";
import { Empty, Panel, Tag } from "@/components/ui";
import { InView, Words } from "@/components/signal/InView";
import { Decode } from "@/components/signal/Decode";
import { SigHead } from "@/components/signal/Head";
import { Bullseye, TugBars } from "@/components/signal/Viz";
import { ago, compact } from "@/lib/format";
import { forecastScale } from "@/lib/viz-math";
import { MultChip, RangeBar } from "@/components/viz";

export const metadata = { title: "Predict" };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`;
const times = (x: number) => (x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`);

type Q = { title?: string; format?: string; minutes?: string; day?: string; hour?: string };

export default async function PredictPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const chs = await getChannels();
  const focus = await focusChannel(chs.filter((c) => c.active).map((c) => c.id));
  const me = chs.find((c) => c.id === focus);
  const header = (
    <InView as="section" className="sec">
      <div className="mono rise" style={{ color: "var(--cyan)" }}>■ Prediction engine{me ? ` · ${me.title}` : ""}</div>
      <h1 className="display mt-5 text-[38px] md:text-[56px]"><Words text="Where the next upload will land." /></h1>
      <p className="rise lede mt-6" style={{ transitionDelay: "300ms" }}>Learns from every tracked account (yours and competitors&apos;; YouTube and Instagram each get their own model) what
        makes a post beat its account&apos;s normal, checks itself on the newest videos, and forecasts where new uploads will land after 30 days.</p>
    </InView>
  );
  if (!me) return <div className="sig">{header}<Empty>Add one of your channels on the Manage page first.</Empty></div>;
  const [engine, forecasts] = await Promise.all([within(engineFor(me.id), 8000, null), within(forecastsFor(me.id), 8000, [])]);
  if (!engine && me.id.startsWith("ig_")) return (<div className="sig">{header}<Empty>Instagram predictions start once the tracked accounts have about 20 posts that are
    at least a week old to learn from (the engine checks every night). New posts are collected automatically.</Empty></div>);
  if (!engine) return (<div className="sig">{header}<Empty>The engine trains every night (02:11 India time). To train it now: GitHub → Actions → “Prediction engine” → Run workflow.</Empty></div>);

  const m = engine.metrics;
  const edge = m.within_2x !== undefined && m.baseline_within_2x !== undefined ? m.within_2x - m.baseline_within_2x : null;
  const draft = q.title !== undefined ? {
    title: q.title.slice(0, 200), short: q.format === "short", minutes: Math.min(240, Math.max(0.2, Number(q.minutes) || (q.format === "short" ? 0.75 : 12))),
    day: Math.min(6, Math.max(0, Number(q.day) || 0)), hour: Math.min(23, Math.max(0, Number(q.hour ?? 18) || 0)),
  } : null;
  const scale = forecastScale(forecasts);
  const est = draft && engine.linear ? estimateDraft(engine.linear, draft) : null;

  const within2 = Math.round((m.within_2x ?? 0) * 100), base2 = Math.round((m.baseline_within_2x ?? 0) * 100);
  return (
    <div className="sig">
      {header}

      <InView as="section" className="sec">
        <SigHead n={1} of={4} label="Accuracy" title="How often it gets it right." />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <Panel title="How accurate it is" subtitle={`Trained ${ago(engine.trainedAt)} on ${compact(engine.videos)} videos from ${engine.channels} channel${engine.channels === 1 ? "" : "s"}`}>
            {m.tested ? (
              <div className="space-y-5">
                <div>
                  <div className="label">Lands within 2× of the real views</div>
                  <div className="display mt-2 text-[52px] leading-none" style={{ color: "var(--cyan)" }}><Decode value={within2} format="pct" /></div>
                </div>
                <div className="space-y-2.5">
                  {([["Prediction engine", within2, "#22e1ff"], ["Every video does the usual", base2, "#55555e"]] as const).map(([l, v, col]) => (
                    <div key={l}>
                      <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3"><span>{l}</span><span>{v}%</span></div>
                      <div className="h-1.5 bg-white/5"><div className="lift-bar h-1.5" style={{ width: `${v}%`, background: col, transformOrigin: "left" }} /></div>
                    </div>
                  ))}
                </div>
                <p className="text-[13.5px] leading-relaxed text-ink-2">
                  Tested on the newest {m.tested} videos, which it didn&apos;t learn from.{" "}
                  {edge !== null && edge >= 0.05 ? "A clear edge over guessing: its drivers are worth acting on."
                    : edge !== null && edge > 0 ? "A small edge before a video is out: titles and timing explain only part of what happens. Forecasts sharpen a lot once a video's first hours are tracked, and every channel you add gives it more to learn from."
                    : "No edge yet before publishing: treat drivers as hints. Forecasts for new uploads still use their real early numbers. Adding channels (incl. competitors) gives it more to learn from."}
                </p>
                {m.live_graded ? <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Live record: {Math.round((m.live_within_2x ?? 0) * 100)}% of {m.live_graded} day-one forecasts landed within 2× at 30 days</p> : null}
              </div>
            ) : <p className="text-[13.5px] text-ink-3">Not enough history to test yet.</p>}
          </Panel>
          <Panel title="What moves views on this channel" subtitle="Measured by the engine; only findings that held in both older and newer videos. Right pulls views up, left pulls them down">
            {engine.drivers.length === 0 ? <p className="text-[13.5px] text-ink-3">Nothing stands out reliably yet. That&apos;s an answer too: titles, day and hour aren&apos;t what decides your views; topic and the first hours are.</p>
              : <TugBars rows={engine.drivers} />}
          </Panel>
        </div>
      </InView>

      <InView as="section" className="sec">
        <SigHead n={2} of={4} label="New uploads" title="Where new uploads will land.">
          30-day views: the engine&apos;s expectation blended with each video&apos;s real numbers so far. Closer to the centre means further above the channel&apos;s normal.
        </SigHead>
        {forecasts.length === 0 ? <Empty>No uploads in the last 30 days.</Empty> : (
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,360px)_1fr]">
            <Bullseye items={forecasts.map((f) => ({ id: f.video_id, title: f.title, vs: f.vs_normal, views: f.views_30d }))} />
            <Panel title="Forecasts" subtitle="Bar = likely range, dot = expected, white tick = views now">
              <div className="scrollbar-thin -mx-2 overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13.5px]">
                  <thead><tr className="text-left">{["Video", "Views now", "In 30 days", "Likely range (log scale)", "Vs normal", "Sure"].map((h) => <th key={h} className="label px-2 py-2 font-normal">{h}</th>)}</tr></thead>
                  <tbody>
                    {forecasts.map((f) => (
                      <tr key={f.video_id} className="border-t border-line">
                        <td className="max-w-[260px] px-2 py-2.5"><Link href={`/videos/${f.video_id}`} className="line-clamp-1 hover:text-accent">{f.title}</Link>
                          <div className="font-mono text-[10px] text-ink-3">{ago(f.published_at)}</div></td>
                        <td className="px-2 py-2.5 font-mono text-[12px] tabular">{compact(f.views_now)}</td>
                        <td className="px-2 py-2.5 tabular"><span className="text-ink">{compact(f.views_30d)}</span> <div className="font-mono text-[10px] text-ink-3">{compact(f.low)}–{compact(f.high)}</div></td>
                        <td className="w-[32%] px-2 py-2.5"><RangeBar low={f.low} high={f.high} expected={f.views_30d} now={f.views_now} vsNormal={f.vs_normal} lo={scale.lo} hi={scale.hi} /></td>
                        <td className="px-2 py-2.5"><MultChip value={f.vs_normal} suffix="" /></td>
                        <td className="px-2 py-2.5">{f.confidence >= 0.66 ? <Tag tone="accent">high</Tag> : f.confidence >= 0.3 ? <Tag>medium</Tag> : <Tag tone="warn">early</Tag>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}
      </InView>

      <InView as="section" className="sec">
        <SigHead n={3} of={4} label="Draft tester" title="Try a draft before you publish.">
          The engine&apos;s estimate for a title, format, length and time (India time).
        </SigHead>
        <div className="border border-line p-5 md:p-8">
          <form className="grid gap-4 sm:grid-cols-6" action="/predict">
            <label className="sm:col-span-6"><span className="label">Draft title</span>
              <input name="title" defaultValue={q.title ?? ""} placeholder="e.g. We tried 5 street foods in Madurai" maxLength={200}
                className="mt-2 h-12 w-full border-0 border-b border-line-2 bg-transparent px-0 text-[18px] text-ink outline-none transition placeholder:text-ink-3/60 focus:border-accent" /></label>
            <label className="sm:col-span-2"><span className="label">Format</span>
              <select name="format" defaultValue={q.format ?? "long"} className="mt-2 h-10 w-full rounded-md border border-line-2 bg-[#0b0b10] px-3 text-[14px]">
                <option value="long">Long video</option><option value="short">Short</option></select></label>
            <label className="sm:col-span-1"><span className="label">Minutes</span>
              <input name="minutes" type="number" step="0.5" min="0.2" max="240" defaultValue={q.minutes ?? "12"} aria-label="Minutes"
                className="mt-2 h-10 w-full rounded-md border border-line-2 bg-[#0b0b10] px-3 text-[14px]" /></label>
            <label className="sm:col-span-2"><span className="label">Day</span>
              <select name="day" defaultValue={q.day ?? "5"} className="mt-2 h-10 w-full rounded-md border border-line-2 bg-[#0b0b10] px-3 text-[14px]">
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
            <label className="sm:col-span-1"><span className="label">Hour</span>
              <select name="hour" defaultValue={q.hour ?? "18"} className="mt-2 h-10 w-full rounded-md border border-line-2 bg-[#0b0b10] px-3 text-[14px]">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></label>
            <button className="pill pill-solid justify-center sm:col-span-6" type="submit"><span className="sq" /> Estimate</button>
          </form>
          {est && (
            <div className="scan-result mt-6 border border-accent/40 p-5">
              <div className="label">Expected after 30 days</div>
              <div className="display mt-2 text-[44px] leading-none" style={{ color: est.multiple >= 1 ? "var(--cyan)" : "var(--magenta)" }}>{est.views !== null ? compact(est.views) : times(est.multiple)}</div>
              <p className="mt-3 text-[14px] text-ink-2">{times(est.multiple)} this channel&apos;s normal{engine.linear?.baseline ? ` (${compact(engine.linear.baseline)} views)` : ""}.
                A rough guide: the topic and the first hours matter more than anything here.</p>
            </div>
          )}
        </div>
      </InView>
    </div>
  );
}
