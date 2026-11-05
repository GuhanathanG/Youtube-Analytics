"use client";

import { Pause, Play, Plus } from "lucide-react";
import { useActionState, useTransition } from "react";
import { addChannel, setChannelActive } from "@/app/actions";

export function AddChannelForm() {
  const [state, action, pending] = useActionState(addChannel, undefined);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row">
      <input name="query" required placeholder="@creator, channel link, or any video link"
        className="h-12 flex-1 rounded-xl border border-line-2 bg-white/[0.03] px-4 text-[15px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60" />
      <button disabled={pending}
        className="flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 px-5 text-[14.5px] font-semibold text-[#05070d] shadow-[0_8px_30px_-8px_rgba(34,211,238,0.6)] transition hover:brightness-110 disabled:opacity-60">
        <Plus size={17} />{pending ? "Adding…" : "Watch channel"}
      </button>
      {state?.ok && <p className="text-[13px] text-accent sm:hidden">{state.ok}</p>}
      {state?.error && <p className="text-[13px] text-neg sm:hidden">{state.error}</p>}
      <span className="sr-only" aria-live="polite">{state?.ok ?? state?.error ?? ""}</span>
      {(state?.ok || state?.error) && (
        <p className={`hidden text-[13px] sm:absolute sm:mt-14 sm:block ${state.ok ? "text-accent" : "text-neg"}`}>{state.ok ?? state.error}</p>
      )}
    </form>
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
