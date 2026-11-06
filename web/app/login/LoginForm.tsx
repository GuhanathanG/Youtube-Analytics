"use client";

import { ArrowRight, Lock } from "lucide-react";
import { useActionState } from "react";
import { login } from "@/app/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="relative block">
        <span className="sr-only">Password</span>
        <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input name="password" type="password" autoFocus required autoComplete="current-password" placeholder="Password"
          className="h-12 w-full rounded-xl border border-line-2 bg-white/[0.03] pl-10 pr-3 text-[15px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60 focus:bg-white/[0.05]" />
      </label>
      {state?.error && <p className="text-[13px] text-neg" role="alert">{state.error}</p>}
      <button disabled={pending}
        className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink text-[15px] font-semibold text-[#0c0c0d] shadow-[0_8px_30px_-8px_rgba(200,169,126,0.6)] transition hover:brightness-110 disabled:opacity-60">
        {pending ? "Checking…" : "Enter"} <ArrowRight size={17} className="transition group-hover:translate-x-0.5" />
      </button>
    </form>
  );
}
