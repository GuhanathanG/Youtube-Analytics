import Link from "next/link";
import { within } from "@/lib/cache";
import { focusChannel } from "@/lib/focus";
import { channels as getChannels } from "@/lib/queries";
import { engineFor, forecastsFor } from "@/lib/engine-model";
import { estimateDraft } from "@/lib/whatif";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel, Tag } from "@/components/ui";
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
    <PageHeader eyebrow={me ? `Predict · ${me.title}` : "Predict"} title={<>Prediction <span className="glow-text">engine</span></>}>
      <p className="max-w-2xl text-[15px] text-ink-2">Learns from every tracked account (yours and competitors&apos;; YouTube and Instagram each get their own model) what
        makes a post beat its account&apos;s normal, checks itself on the newest videos, and forecasts where new uploads will land after 30 days.</p>
    </PageHeader>
  );
  if (!me) return <>{header}<Empty>Add one of your channels on the Manage page first.</Empty></>;
  const [engine, forecasts] = await Promise.all([within(engineFor(me.id), 8000, null), within(forecastsFor(me.id), 8000, [])]);
  if (!engine && me.id.startsWith("ig_")) return (<>{header}<Empty>Instagram predictions start once this account has about 40 posts that are
    at least a week old to learn from (the engine checks every night). New posts are collected automatically.</Empty></>);
  if (!engine) return (<>{header}<Empty>The engine trains every night (02:11 India time). To train it now: GitHub → Actions → “Prediction engine” → Run workflow.</Empty></>);

  const m = engine.metrics;
  const edge = m.within_2x !== undefined && m.baseline_within_2x !== undefined ? m.within_2x - m.baseline_within_2x : null;
  const draft = q.title !== undefined ? {
    title: q.title.slice(0, 200), short: q.format === "short", minutes: Math.min(240, Math.max(0.2, Number(q.minutes) || (q.format === "short" ? 0.75 : 12))),
    day: Math.min(6, Math.max(0, Number(q.day) || 0)), hour: Math.min(23, Math.max(0, Number(q.hour ?? 18) || 0)),
  } : null;
  const scale = forecastScale(forecasts);
  const est = draft && engine.linear ? estimateDraft(engine.linear, draft) : null;

  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-1"><Panel title="How accurate it is" subtitle={`Trained ${ago(engine.trainedAt)} on ${compact(engine.videos)} videos from ${engine.channels} channel${engine.channels === 1 ? "" : "s"}`}>
          {m.tested ? (
            <div className="space-y-4">
              <div>
                <div className="label">Lands within 2× of the real views</div>
                <div className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tabular">{Math.round((m.within_2x ?? 0) * 100)}%</div>
                <p className="mt-1 text-[12.5px] text-ink-3">“Every video does the channel&apos;s usual” manages {Math.round((m.baseline_within_2x ?? 0) * 100)}%.
                  Tested on the newest {m.tested} videos, which it didn&apos;t learn from.</p>
              </div>
              <p className="text-[13px] text-ink-2">
                {edge !== null && edge >= 0.05 ? "A clear edge over guessing: its drivers are worth acting on."
                  : edge !== null && edge > 0 ? "A small edge before a video is out: titles and timing explain only part of what happens. Forecasts sharpen a lot once a video's first hours are tracked, and every channel you add gives it more to learn from."
                  : "No edge yet before publishing: treat drivers as hints. Forecasts for new uploads still use their real early numbers. Adding channels (incl. competitors) gives it more to learn from."}
              </p>
              {m.live_graded ? <p className="text-[12.5px] text-ink-3">Live record: {Math.round((m.live_within_2x ?? 0) * 100)}% of {m.live_graded} day-one forecasts landed within 2× at 30 days.</p> : null}
            </div>
          ) : <p className="text-[13px] text-ink-3">Not enough history to test yet.</p>}
        </Panel></Reveal>

        <Reveal className="lg:col-span-2"><Panel title="What moves views on this channel" subtitle="Measured by the engine; only findings that held in both older and newer videos">
          {engine.drivers.length === 0 ? <p className="text-[13px] text-ink-3">Nothing stands out reliably yet. That&apos;s an answer too: titles, day and hour aren&apos;t what decides your views; topic and the first hours are.</p> : (
            <ul className="space-y-3">
              {engine.drivers.map((d) => (
                <li key={d.key} className="flex items-center gap-3">
                  <span className={`w-16 shrink-0 text-right font-[family-name:var(--font-display)] text-lg font-semibold tabular ${d.effect >= 0 ? "text-pos" : "text-neg"}`}>{pct(d.effect)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] text-ink">{d.label}</div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/5"><div className={`h-1.5 rounded-full ${d.effect >= 0 ? "bg-pos/70" : "bg-neg/70"}`} style={{ width: `${Math.min(100, Math.abs(d.effect) * 100)}%` }} /></div>
                  </div>
                  <Tag>{d.kind}</Tag>
                </li>
              ))}
            </ul>
          )}
        </Panel></Reveal>
      </div>

      <Reveal className="mt-4 block"><Panel title="Where new uploads will land" subtitle="30-day views: the engine's expectation blended with each video's real numbers so far. Bar = likely range, dot = expected, white tick = views now">
        {forecasts.length === 0 ? <p className="text-[13px] text-ink-3">No uploads in the last 30 days.</p> : (
          <div className="scrollbar-thin -mx-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead><tr className="text-left">{["Video", "Views now", "In 30 days", "Likely range (log scale)", "Vs normal", "Sure"].map((h) => <th key={h} className="label px-2 py-2 font-normal">{h}</th>)}</tr></thead>
              <tbody>
                {forecasts.map((f) => (
                  <tr key={f.video_id} className="border-t border-line">
                    <td className="max-w-[280px] px-2 py-2"><Link href={`/videos/${f.video_id}`} className="line-clamp-1 hover:text-accent">{f.title}</Link>
                      <div className="text-[11.5px] text-ink-3">{ago(f.published_at)}</div></td>
                    <td className="px-2 py-2 tabular">{compact(f.views_now)}</td>
                    <td className="px-2 py-2 tabular"><span className="text-ink">{compact(f.views_30d)}</span> <div className="text-[11.5px] text-ink-3">{compact(f.low)}–{compact(f.high)}</div></td>
                    <td className="w-[34%] px-2 py-2"><RangeBar low={f.low} high={f.high} expected={f.views_30d} now={f.views_now} vsNormal={f.vs_normal} lo={scale.lo} hi={scale.hi} /></td>
                    <td className="px-2 py-2"><MultChip value={f.vs_normal} suffix="" /></td>
                    <td className="px-2 py-2">{f.confidence >= 0.66 ? <Tag tone="accent">high</Tag> : f.confidence >= 0.3 ? <Tag>medium</Tag> : <Tag tone="warn">early</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel></Reveal>

      <Reveal className="mt-4 block"><Panel title="Try a draft before you publish" subtitle="The engine's estimate for a title, format, length and time (India time)">
        <form className="grid gap-3 sm:grid-cols-6" action="/predict">
          <input name="title" defaultValue={q.title ?? ""} placeholder="Draft title" maxLength={200}
            className="rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50 sm:col-span-6" />
          <select name="format" defaultValue={q.format ?? "long"} className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-[14px] sm:col-span-2">
            <option value="long">Long video</option><option value="short">Short</option></select>
          <input name="minutes" type="number" step="0.5" min="0.2" max="240" defaultValue={q.minutes ?? "12"} aria-label="Minutes"
            className="rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[14px] sm:col-span-1" />
          <select name="day" defaultValue={q.day ?? "5"} className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-[14px] sm:col-span-2">
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <select name="hour" defaultValue={q.hour ?? "18"} className="rounded-lg border border-line bg-bg-2 px-3 py-2 text-[14px] sm:col-span-1">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
          <button className="btn-neon justify-center sm:col-span-6" type="submit">Estimate</button>
        </form>
        {est && (
          <div className="mt-4 rounded-xl border border-line bg-white/[0.02] p-4">
            <div className="label">Expected after 30 days</div>
            <div className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tabular">{est.views !== null ? compact(est.views) : times(est.multiple)}</div>
            <p className="mt-1 text-[13px] text-ink-2">{times(est.multiple)} this channel&apos;s normal{engine.linear?.baseline ? ` (${compact(engine.linear.baseline)} views)` : ""}.
              A rough guide: the topic and the first hours matter more than anything here.</p>
          </div>
        )}
      </Panel></Reveal>
    </>
  );
}
