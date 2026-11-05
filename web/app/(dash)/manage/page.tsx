import { ExternalLink } from "lucide-react";
import { AddChannelForm, FullSyncButton, ToggleChannel } from "@/components/ChannelControls";
import { githubConfigured, recentRuns } from "@/lib/github";
import { engineStatus, storageStatus } from "@/lib/live";
import { utc } from "@/lib/db-time";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel, Tag } from "@/components/ui";
import { ago, compact } from "@/lib/format";
import { actionsMinutesThisMonth, channelRequests, channels as getChannels, kpis, lastRuns, llmUsageToday, progress } from "@/lib/queries";
import { ProgressPanel } from "@/components/ProgressPanel";

export const metadata = { title: "Manage" };

const REPO_ACTIONS = "https://github.com/GuhanathanG/Youtube-Analytics/actions/workflows/sync.yml";

function Meter({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const p = Math.min(100, (used / total) * 100);
  const color = p > 90 ? "#e66767" : p > 70 ? "#fab219" : "#22d3ee";
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      <div className="label">{label}</div>
      <div className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tabular">
        {used.toLocaleString("en")}<span className="text-[14px] font-normal text-ink-3"> / {total.toLocaleString("en")} {unit}</span>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-white/5">
        <div className="h-1.5 rounded-full" style={{ width: `${p}%`, background: color, boxShadow: `0 0 10px ${color}66` }} />
      </div>
    </div>
  );
}

export default async function ManagePage() {
  const [chs, reqs, k, minutes, usage, runs] = await Promise.all([
    getChannels(), channelRequests(), kpis(), actionsMinutesThisMonth(), llmUsageToday(), lastRuns(12),
  ]);
  const ghRuns = await recentRuns(5).catch(() => null);
  const engine = await engineStatus().catch(() => null);
  const prog = await progress().catch(() => []);
  const storage = await storageStatus().catch(() => null);
  const cronAt = utc(engine?.lastCronAt);
  const alwaysOn = !!cronAt && Date.now() - cronAt.getTime() < 10 * 60000;
  const e = engine?.last;
  return (
    <>
      <PageHeader eyebrow="Control room" title={<>Manage <span className="glow-text">watchlist</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">
          Add a creator and their newest videos and comments load in seconds. Live mode then keeps them up to date
          while this site is open, and the background job fills in the full comment history.
        </p>
      </PageHeader>

      <Reveal>
        <Panel title={<span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${alwaysOn ? "bg-accent animate-[pulse-dot_2s_ease-out_infinite]" : "bg-warn"}`} />Engine</span>}
          subtitle={alwaysOn ? "Running 24/7: new comments, history and AI analysis keep flowing even when this site is closed"
            : "Only runs while this site is open. Set up the free timer in the README (step 7) to run it 24/7."}>
          <div className="grid gap-3 text-[13px] sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Last run", e ? ago(e.at) : "never"],
              ["Timer (24/7)", cronAt ? ago(engine?.lastCronAt) : "not set up"],
              ["New comments", String(e?.newComments ?? 0)],
              ["History saved", String(e?.backfilled ?? 0)],
              ["Read by AI", String((e?.labelled ?? 0) + (e?.aiBacklog ?? 0))],
              ["Briefings", String(e?.insights ?? 0)],
              ["Run time", e?.durationMs ? `${(e.durationMs / 1000).toFixed(0)} s` : "–"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                <div className="label">{k}</div>
                <div className="mt-1 tabular text-[15px] text-ink">{v}</div>
              </div>
            ))}
          </div>
          {e?.message && <p className={`mt-3 text-[12.5px] ${e.status === "ok" ? "text-ink-3" : "text-warn"}`}>{e.message}</p>}
        </Panel>
      </Reveal>

      <Reveal className="mt-4"><ProgressPanel rows={prog} /></Reveal>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Reveal className="xl:col-span-2"><Panel title="Watch a new channel"><AddChannelForm /></Panel></Reveal>
        <Reveal delay={0.05}>
          <Panel title="Full sync" subtitle="History download + bulk analysis (runs every 2 hours on its own)">
            <FullSyncButton enabled={githubConfigured()} />
            {!githubConfigured() && (
              <p className="mt-3 text-[12.5px] text-ink-3">To start it from here, add a <span className="font-mono">GITHUB_TOKEN</span> in Vercel (see the README). Until then: <a href={REPO_ACTIONS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">run on GitHub<ExternalLink size={12} /></a></p>
            )}
            {ghRuns && ghRuns.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {ghRuns.map((r) => (
                  <li key={r.html_url} className="flex items-center gap-2.5 text-[12.5px]">
                    <span className={`h-2 w-2 rounded-full ${r.status !== "completed" ? "bg-accent animate-[pulse-dot_2s_ease-out_infinite]" : r.conclusion === "success" ? "bg-good" : "bg-neg"}`} />
                    <span className="text-ink-2">{r.status !== "completed" ? "running" : r.conclusion}</span>
                    <span className="text-ink-3">{r.event === "schedule" ? "scheduled" : "manual"}</span>
                    <span className="ml-auto text-ink-3">{ago(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Reveal>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Reveal delay={0.05} className="xl:col-span-2">
          <Panel title="Watchlist" subtitle="Pausing stops new downloads; stored data stays">
            {chs.length === 0 ? <Empty>Nothing yet. Add your first creator above.</Empty> : (
              <ul className="divide-y divide-line">
                {chs.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-3">
                    {c.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumbnail_url} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-white/10" />
                    ) : <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10">{c.title.slice(0, 1)}</div>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] text-ink">{c.title}</div>
                      <div className="truncate text-[12.5px] text-ink-3">
                        {c.handle ?? c.id} · {compact(c.comments)} comments · {c.videos_backfilled}/{c.videos_stored} videos complete · synced {ago(c.last_synced_at)}
                      </div>
                    </div>
                    {c.active ? <Tag tone="accent">live</Tag> : <Tag tone="warn">paused</Tag>}
                    <ToggleChannel id={c.id} active={c.active} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Reveal>
        <Reveal delay={0.1}>
          <Panel title="Requests" subtitle="Channels you added">
            {reqs.length === 0 ? <Empty>No requests yet.</Empty> : (
              <ul className="space-y-2">
                {reqs.slice(0, 12).map((r) => (
                  <li key={r.id} className="rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] text-ink">{r.query}</span>
                      <span className="ml-auto">{r.status === "done" ? <Tag tone="accent">added</Tag> : r.status === "error" ? <Tag tone="warn">not found</Tag> : <Tag>waiting for next run</Tag>}</span>
                    </div>
                    {r.error && <p className="mt-1 text-[12px] text-ink-3">{r.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Reveal>
      </div>

      <Reveal delay={0.15} className="mt-4">
        <Panel title="Free-tier fuel" subtitle="Everything here runs on free plans; the app paces itself to stay inside them">
          {storage?.nearlyFull && (
            <p className="mb-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
              The database is over 90% full, so downloading past comments is paused. New comments still arrive. Pause channels you no longer need, or ask Claude to archive old data.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <Meter label="GitHub Actions · this month" used={minutes} total={2000} unit="min" />
            <Meter label="YouTube API · today" used={k.quota_used_today} total={10000} unit="units" />
            {storage && <Meter label="Database storage (Supabase free)" used={storage.usedMb} total={storage.limitMb} unit="MB" />}
          </div>
          <div className="mt-4">
            <div className="label mb-2">Free AI models · today</div>
            {usage.length === 0 ? <p className="text-[13px] text-ink-3">No AI requests yet today.</p> : (
              <ul className="grid gap-2 md:grid-cols-2">
                {usage.map((u) => (
                  <li key={u.model_key} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 text-[13px]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${u.exhausted ? "bg-warn" : "bg-accent"}`} />
                    <span className="truncate font-mono text-[12.5px] text-ink-2">{u.model_key}</span>
                    <span className="ml-auto shrink-0 tabular text-ink">{u.requests} req</span>
                    {u.exhausted && <span className="shrink-0 text-[11.5px] text-warn" title={u.last_error ?? ""}>used up</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </Reveal>

      <Reveal delay={0.2} className="mt-4">
        <Panel title="Background runs" subtitle="What the robot did recently">
          {runs.length === 0 ? <Empty>No runs yet.</Empty> : (
            <ul className="space-y-1.5">
              {runs.map((r, i) => {
                let detail = "";
                try {
                  const s = JSON.parse(r.summary ?? "{}");
                  detail = r.kind === "sync" ? `${(s.comments_saved ?? 0).toLocaleString("en")} comments saved · ${s.stopped_reason ?? ""}`
                    : r.kind === "analyze" ? `${(s.analyzed ?? 0).toLocaleString("en")} comments analysed`
                    : `${s.comments ?? 0} comments read by AI · ${s.insights ?? 0} briefings`;
                } catch { /* ignore */ }
                return (
                  <li key={i} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-white/[0.03]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${r.status === "ok" ? "bg-good" : r.status === "running" ? "bg-accent" : "bg-neg"}`} />
                    <span className="w-16 shrink-0 font-mono text-[12px] uppercase text-ink-3">{r.kind}</span>
                    <span className="truncate text-ink-2">{detail}</span>
                    <span className="ml-auto shrink-0 text-ink-3">{ago(r.started_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </Reveal>
    </>
  );
}
