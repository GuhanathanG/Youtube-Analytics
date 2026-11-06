"use client";

import { Pause, Play, Plus, RefreshCw } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { addChannel, runFullSync, setChannelActive, setChannelRole, testAlertAction, addInstagram } from "@/app/actions";

export function AddChannelForm() {
  const [state, action, pending] = useActionState(addChannel, undefined);
  return (
    <form action={action}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input name="query" required aria-label="Channel to watch" placeholder="@creator, channel link, or any video link"
          className="h-12 flex-1 rounded-xl border border-line-2 bg-white/[0.03] px-4 text-[15px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60" />
        <button disabled={pending}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 text-[14px] font-medium text-[#0c0c0d] transition hover:bg-accent disabled:opacity-60">
          <Plus size={17} />{pending ? "Fetching from YouTube…" : "Watch channel"}
        </button>
      </div>
      <p className={`mt-3 min-h-5 text-[13px] ${state?.error ? "text-neg" : "text-accent"}`} aria-live="polite">
        {pending ? "Looking up the channel and loading its newest videos and comments…" : state?.ok ?? state?.error ?? ""}
      </p>
    </form>
  );
}

export function AddInstagramForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(addInstagram, undefined);
  return (
    <form action={action}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input name="query" required disabled={!configured} aria-label="Instagram account to watch" placeholder="@username or instagram.com/username"
          className="h-12 flex-1 rounded-xl border border-line-2 bg-white/[0.03] px-4 text-[15px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60 disabled:opacity-50" />
        <button disabled={pending || !configured}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 text-[14px] font-medium text-[#0c0c0d] transition hover:bg-accent disabled:opacity-60">
          <Plus size={17} />{pending ? "Starting…" : "Watch on Instagram"}
        </button>
      </div>
      <p className={`mt-3 min-h-5 text-[13px] ${state?.error ? "text-neg" : "text-accent"}`} aria-live="polite">
        {!configured ? "Add APIFY_TOKEN in Vercel to watch Instagram accounts." : pending ? "Asking Apify for the profile and posts…" : state?.ok ?? state?.error ?? ""}
      </p>
    </form>
  );
}

export function FullSyncButton({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div>
      <button disabled={!enabled || pending} onClick={() => start(async () => setMsg(await runFullSync()))}
        className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-[14px] font-medium text-ink transition hover:bg-accent/20 disabled:opacity-50">
        <RefreshCw size={15} className={pending ? "animate-spin" : ""} />{pending ? "Starting…" : "Run full sync now"}
      </button>
      {msg && <p className={`mt-2 text-[13px] ${msg.ok ? "text-accent" : "text-neg"}`}>{msg.message}</p>}
    </div>
  );
}

export function CompetitorToggle({ id, competitor }: { id: string; competitor: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(() => setChannelRole(id, !competitor))} title={competitor ? "Make it one of your channels again" : "Track as a competitor: videos and stats only"}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] transition disabled:opacity-50 ${competitor ? "border-accent-2/50 text-accent-2" : "border-line text-ink-2 hover:text-ink"}`}>
      {competitor ? "Competitor ✓" : "Mark as competitor"}
    </button>
  );
}

export function ToggleChannel({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(() => setChannelActive(id, !active))}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-2 transition hover:border-line-2 hover:text-ink disabled:opacity-50">
      {active ? <><Pause size={13} />Pause</> : <><Play size={13} />Resume</>}
    </button>
  );
}

export function TestAlertButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[13px] text-accent">● Connected</span>
      <button disabled={pending} onClick={() => start(async () => setMsg(await testAlertAction()))}
        className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-2 transition hover:border-accent/50 hover:text-ink disabled:opacity-50">
        {pending ? "Sending…" : "Send a test message"}
      </button>
      {msg && <span className={`text-[12.5px] ${msg.ok ? "text-accent" : "text-neg"}`}>{msg.message}</span>}
    </div>
  );
}
