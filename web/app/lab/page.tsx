import { within } from "@/lib/cache";
import { ago, compact } from "@/lib/format";
import { workflowRuns, githubConfigured, type LabRun } from "@/lib/github";
import { TRAINERS, engineModels, readerModel, tanglishModel, trainingData, type EngineScore, type ReaderTask } from "@/lib/lab";
import { TrainButton } from "./LabControls";
import { LiveTraining } from "./LiveTraining";

export const metadata = { title: "Models" };

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
const num = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "–" : x.toFixed(d));
const TASKS: [string, string][] = [["mood", "Mood"], ["emotion", "Emotion (16)"], ["question", "Question"], ["suggestion", "Suggestion"],
  ["spam", "Spam"], ["toxic", "Toxic"], ["aspects", "Topics + feeling"]];

function RunList({ runs }: { runs: LabRun[] | null }) {
  if (!runs) return <p className="mono mt-3" style={{ fontSize: 10.5 }}>GitHub runs can&apos;t be read (GITHUB_TOKEN).</p>;
  if (!runs.length) return <p className="mono mt-3" style={{ fontSize: 10.5 }}>No runs yet.</p>;
  return (
    <ul className="mt-3 space-y-1.5">
      {runs.map((r) => {
        const live = r.status !== "completed";
        const color = live ? "var(--cyan)" : r.conclusion === "success" ? "var(--ink)" : "var(--magenta)";
        return (
          <li key={r.id} className="flex items-baseline justify-between gap-3 text-[13px]">
            <a href={r.html_url} target="_blank" rel="noreferrer" className="hover:text-[var(--cyan)]">#{r.run_number} · {r.event === "schedule" ? "weekly" : r.event === "workflow_dispatch" ? "started by hand" : r.event}</a>
            <span className="mono shrink-0" style={{ fontSize: 10.5, color }}>{live ? `${r.status.replace("_", " ")} · ${ago(r.created_at)}` : `${r.conclusion} · ${ago(r.updated_at)}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ScoreRow({ name, s, chosen }: { name: string; s: EngineScore; chosen: boolean }) {
  return (
    <tr className="border-t border-[var(--hair)]">
      <td className="py-2 pr-3">{name}{chosen && <span className="mono ml-2" style={{ fontSize: 9.5, color: "var(--cyan)" }}>IN USE</span>}</td>
      <td className="py-2 pr-3 tabular">{pct(s.within_2x)}</td>
      <td className="py-2 pr-3 tabular">{num(s.rank_corr)}</td>
      <td className="py-2 tabular">{s.typical_miss ? `${s.typical_miss.toFixed(2)}×` : "–"}</td>
    </tr>
  );
}

export default async function LabPage() {
  const [reader, engines, tanglish, data, readerRuns, engineRuns] = await Promise.all([
    within(readerModel(), 6000, null), within(engineModels(), 6000, []), within(tanglishModel(), 6000, null),
    within(trainingData(), 8000, null), within(workflowRuns(TRAINERS.reader.file, 4), 6000, null), within(workflowRuns(TRAINERS.engine.file, 4), 6000, null),
  ]);
  const channelRuns = await within(workflowRuns(TRAINERS.channels.file, 3), 6000, null);
  const canStart = githubConfigured();
  return (
    <>
      <section className="pt-14 md:pt-20">
        <div className="mono" style={{ color: "var(--cyan)" }}>■ Our own models</div>
        <h1 className="display mt-5 text-[34px] md:text-[52px]">Trained on your data, for free.</h1>
        <p className="lede mt-5">Each model trains on GitHub&apos;s free machines, is tested on data it never saw, and only replaces the one in use when it does at
          least as well. Start a run here, then add channels to learn from on <a className="text-[var(--cyan)]" href="/lab/channels">Training channels</a>.</p>
      </section>

      <LiveTraining />

      {/* Pulse Reader */}
      <section className="mt-14 grid gap-px bg-[var(--hair)] lg:grid-cols-[1.4fr_1fr]">
        <div className="bg-[var(--bg)] p-6 md:p-8">
          <div className="mono" style={{ fontSize: 10.5 }}>01 · Comments</div>
          <h2 className="display mt-3 text-[26px]">Pulse Reader</h2>
          <p className="mt-2 max-w-[60ch] text-[14px] text-ink-2">Reads a comment the way the cloud AI does: mood, emotion, questions, suggestions, spam, toxicity and topics. Scored
            against the cloud AI&apos;s own labels on held-out comments; a label is only used when the model is at least as sure as the trusted cut-off.</p>
          {reader ? (
            <>
              <div className="mono mt-5 flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 10.5 }}>
                <span>Trained {ago(reader.trainedAt)}</span><span>{compact(reader.trainRows)} comments learned from</span>
                <span>{compact(reader.testRows)} held out</span>{reader.release && <span>release {reader.release}</span>}
              </div>
              <table className="mt-4 w-full text-[13.5px]">
                <thead><tr className="text-left">{["Label", "Agrees with cloud AI", "Trusted share", "At agreement"].map((h) => <th key={h} className="mono py-1.5 pr-3 font-normal" style={{ fontSize: 10 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {TASKS.map(([k, label]) => {
                    const t = reader.tasks[k] as ReaderTask | undefined;
                    if (!t) return null;
                    const agree = t.accuracy ?? t.exact_match ?? t.f1;
                    return (
                      <tr key={k} className="border-t border-[var(--hair)]">
                        <td className="py-2 pr-3">{label}</td>
                        <td className="py-2 pr-3 tabular">{pct(agree)}{t.f1 !== undefined && <span className="mono ml-1" style={{ fontSize: 9.5 }}>F1</span>}</td>
                        <td className="py-2 pr-3 tabular" style={{ color: reader.thresholds[k] ? "var(--cyan)" : "var(--ink-3)" }}>{reader.thresholds[k] ? pct(t.coverage) : "not trusted yet"}</td>
                        <td className="py-2 tabular">{reader.thresholds[k] ? pct(t.agreement) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : <p className="mt-5 text-[14px] text-ink-3">Not trained yet: start the first run on the right (about 1–3 hours).</p>}
        </div>
        <div className="bg-[var(--bg)] p-6 md:p-8">
          <div className="mono" style={{ fontSize: 10.5 }}>Train</div>
          <p className="mt-3 text-[13.5px] text-ink-2">{TRAINERS.reader.what} Runs by itself every Sunday.</p>
          <div className="mt-4">{canStart ? <TrainButton which="reader" label="Train Pulse Reader now" /> : <p className="text-[13px] text-ink-3">Add GITHUB_TOKEN in Vercel to start runs from here.</p>}</div>
          <RunList runs={readerRuns} />
        </div>
      </section>

      {/* Creator Model */}
      <section className="mt-px grid gap-px bg-[var(--hair)] lg:grid-cols-[1.4fr_1fr]">
        <div className="bg-[var(--bg)] p-6 md:p-8">
          <div className="mono" style={{ fontSize: 10.5 }}>02 · Performance</div>
          <h2 className="display mt-3 text-[26px]">Creator Model</h2>
          <p className="mt-2 max-w-[60ch] text-[14px] text-ink-2">Predicts where an upload lands against its channel&apos;s normal, from title, length, timing, thumbnail and its first hours.
            Each night it tests the current signals and the richer set on the newest 20% of videos and keeps the better one.</p>
          {engines.length ? engines.map((e) => (
            <div key={e.platform} className="mt-5">
              <div className="mono flex flex-wrap gap-x-5" style={{ fontSize: 10.5 }}>
                <span style={{ color: "var(--ink)" }}>{e.platform === "instagram" ? "Instagram" : "YouTube"}</span><span>{compact(e.videos)} videos · {e.channels} channel{e.channels === 1 ? "" : "s"}</span>
                <span>trained {ago(e.trainedAt)}</span>{e.metrics.tested ? <span>tested on {e.metrics.tested} newest</span> : null}
              </div>
              <table className="mt-2 w-full text-[13.5px]">
                <thead><tr className="text-left">{["Signals", "Within 2×", "Ranking (0–1)", "Typical miss"].map((h) => <th key={h} className="mono py-1.5 pr-3 font-normal" style={{ fontSize: 10 }}>{h}</th>)}</tr></thead>
                <tbody>
                  <ScoreRow name="Channel's usual (no model)" s={{ within_2x: e.metrics.baseline_within_2x, typical_miss: (e.metrics as { baseline_typical_miss?: number }).baseline_typical_miss, rank_corr: null }} chosen={false} />
                  {e.candidates.base && <ScoreRow name="Title, length, timing" s={e.candidates.base} chosen={e.featureSet === "base"} />}
                  {e.candidates.creator_v1 && <ScoreRow name="+ thumbnail + first hours" s={e.candidates.creator_v1} chosen={e.featureSet === "creator_v1"} />}
                  {!e.candidates.base && <ScoreRow name="Current model" s={e.metrics} chosen />}
                </tbody>
              </table>
            </div>
          )) : <p className="mt-5 text-[14px] text-ink-3">Not trained yet.</p>}
        </div>
        <div className="bg-[var(--bg)] p-6 md:p-8">
          <div className="mono" style={{ fontSize: 10.5 }}>Train</div>
          <p className="mt-3 text-[13.5px] text-ink-2">{TRAINERS.engine.what} Runs by itself every night.</p>
          <div className="mt-4">{canStart ? <TrainButton which="engine" label="Train Creator Model now" /> : <p className="text-[13px] text-ink-3">Add GITHUB_TOKEN in Vercel to start runs from here.</p>}</div>
          <RunList runs={engineRuns} />
          <p className="mt-6 text-[13.5px] text-ink-2">{TRAINERS.channels.what}</p>
          <div className="mt-3">{canStart ? <TrainButton which="channels" label="Refresh training channels now" /> : null}</div>
          <RunList runs={channelRuns} />
        </div>
      </section>

      {/* Other models */}
      <section className="mt-px grid gap-px bg-[var(--hair)] md:grid-cols-2">
        <div className="bg-[var(--bg)] p-6 md:p-8">
          <div className="mono" style={{ fontSize: 10.5 }}>03 · Mood (light)</div>
          <h2 className="display mt-3 text-[22px]">Tanglish mood head</h2>
          {tanglish ? <p className="mt-3 text-[14px] text-ink-2">Agrees with the cloud AI {pct(tanglish.macro_f1)} (macro-F1) vs {pct(tanglish.current_macro_f1)} for the default model · trained on {compact(tanglish.trained_on ?? 0)} comments
            {ago(tanglish.trainedAt) ? `, ${ago(tanglish.trainedAt)}` : ""} · {tanglish.in_use ? "in use" : "not in use"}. Retrains with the Creator Model on Sundays.</p>
            : <p className="mt-3 text-[14px] text-ink-3">Not trained yet.</p>}
        </div>
        <div className="bg-[var(--bg)] p-6 md:p-8">
          <div className="mono" style={{ fontSize: 10.5 }}>04 · Writing</div>
          <h2 className="display mt-3 text-[22px]">Pulse Analyst</h2>
          <p className="mt-3 text-[14px] text-ink-2">A small writing model for briefs and summaries, trained on Kaggle&apos;s free GPU from {compact(data?.insights ?? 0)} insights the cloud AI wrote.
            Waiting for the GitHub secrets <span className="mono">KAGGLE_USERNAME</span> and <span className="mono">KAGGLE_KEY</span>.</p>
        </div>
      </section>

      {/* Training data */}
      {data && (
        <section className="mt-14">
          <div className="mono" style={{ color: "var(--cyan)" }}>■ What the models learn from</div>
          <div className="mt-5 grid gap-px bg-[var(--hair)] sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Comments read by the cloud AI", compact(data.aiLabelledMain + data.aiLabelledArchive), `${compact(data.aiLabelledMain)} recent + ${compact(data.aiLabelledArchive)} archived`],
              ["Videos", compact(Object.values(data.videos).reduce((a, b) => a + b, 0) + data.trainingVideos),
                [...Object.entries(data.videos).map(([k, v]) => `${compact(v)} ${k === "yours" ? "yours" : k === "competitor" ? "competitors'" : "other"}`),
                  `${compact(data.trainingVideos)} from ${data.trainingChannels} training channels`].join(" · ")],
              ["Views snapshots", compact(data.snapshots), `${data.earlySnapshotVideos} videos with a first-day reading`],
              ["Thumbnails analysed", compact(data.thumbnails), `${compact(data.archiveComments)} comments in the archive`],
            ].map(([label, value, note]) => (
              <div key={label} className="bg-[var(--bg)] p-6">
                <div className="mono" style={{ fontSize: 10 }}>{label}</div>
                <div className="display mt-3 text-[30px] tabular">{value}</div>
                <div className="mt-2 text-[12.5px] text-ink-3">{note}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
