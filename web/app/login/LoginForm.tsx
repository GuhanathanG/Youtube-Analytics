"use client";

import { ArrowRight } from "lucide-react";
import { useActionState } from "react";
import { login } from "@/app/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="w-full max-w-[420px] text-center">
      {/* The pulse: a glowing core with rings; it races while the password is checked. */}
      <div className={`login-orb mx-auto ${pending ? "busy" : ""} ${state?.error ? "err" : ""}`} aria-hidden>
        <i /><i /><i /><b />
      </div>
      <div className="label mt-10" style={{ color: "var(--color-accent)" }}>■ Sign in</div>
      <h1 className="mt-4 font-[family-name:var(--font-display)] text-[34px] font-extrabold leading-[1.08] tracking-[-0.005em] sm:text-[42px]">Enter the signal.</h1>
      <p className="mx-auto mt-4 max-w-[34ch] text-[15.5px] leading-relaxed text-ink-2">Every comment across your channels, read and scored. Your password opens it.</p>
      <input type="hidden" name="next" value={next} />
      <div className="mt-10 flex items-end gap-3 text-left">
        <label className="block flex-1">
          <span className="label">Password</span>
          <input name="password" type="password" autoFocus required autoComplete="current-password" placeholder="••••••••"
            className="mt-2 h-12 w-full border-0 border-b border-line-2 bg-transparent px-0 text-[18px] tracking-[0.2em] text-ink outline-none transition placeholder:text-ink-3/50 focus:border-accent" />
        </label>
        <button disabled={pending} aria-label="Enter"
          className="group flex h-12 shrink-0 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-bg transition hover:bg-accent hover:shadow-[0_0_28px_rgba(34,225,255,.5)] disabled:opacity-60">
          {pending ? "Checking" : "Enter"} <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
        </button>
      </div>
      <p className="mt-4 min-h-5 text-left font-mono text-[11.5px] uppercase tracking-[0.12em] text-neg" role="alert">{state?.error ?? ""}</p>
    </form>
  );
}
