"use client";

import { useActionState, useState, useTransition } from "react";
import { addTrainingChannel, setTrainingActive, startTraining } from "./actions";
import type { TrainerKey } from "@/lib/lab";

export function TrainButton({ which, label }: { which: TrainerKey; label: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div>
      <button type="button" disabled={pending} onClick={() => start(async () => setMsg(await startTraining(which)))}
        className="pill pill-solid disabled:opacity-50">{pending ? "Starting…" : label}</button>
      {msg && <p role="status" className="mt-2 text-[12.5px]" style={{ color: msg.ok ? "var(--cyan)" : "var(--magenta)" }}>{msg.message}</p>}
    </div>
  );
}

export function AddTrainingChannel({ categories }: { categories: readonly string[] }) {
  const [state, action, pending] = useActionState(addTrainingChannel, undefined);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <input name="query" required placeholder="@handle, channel link or name" aria-label="YouTube channel to learn from"
        className="min-w-0 flex-1 border border-[var(--hair-2)] bg-transparent px-4 py-2.5 text-[14px] outline-none focus:border-[var(--cyan)]" />
      <select name="category" aria-label="Niche" defaultValue="Other"
        className="border border-[var(--hair-2)] bg-[var(--bg)] px-3 py-2.5 text-[14px] outline-none focus:border-[var(--cyan)]">
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <button disabled={pending} className="pill pill-solid disabled:opacity-50">{pending ? "Adding…" : "Learn from this channel"}</button>
      {state?.ok && <p role="status" className="text-[13px] sm:basis-full" style={{ color: "var(--cyan)" }}>{state.ok}</p>}
      {state?.error && <p role="alert" className="text-[13px] sm:basis-full" style={{ color: "var(--magenta)" }}>{state.error}</p>}
    </form>
  );
}

export function PauseToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => setTrainingActive(id, !active))}
      className="pill pill-line disabled:opacity-50" style={{ fontSize: 12 }}>{active ? "Pause" : "Resume"}</button>
  );
}
