"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

/**
 * Shown when a page fails to load (almost always: the small database was busy for a moment).
 * It retries by itself a few times, with growing waits, before asking you to.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  const [left, setLeft] = useState(3);
  const msg = error.message || "";
  const db = /DATABASE_URL|password authentication|ENOTFOUND|Tenant or user/i.test(msg);
  const auto = !db && tries < 3;

  const retry = () => {
    setTries((t) => t + 1);
    startTransition(() => { router.refresh(); reset(); });
  };

  useEffect(() => {
    if (!auto) return;
    const wait = 3 + tries * 3; // 3 s, 6 s, 9 s
    setLeft(wait);
    const tick = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    const t = setTimeout(retry, wait * 1000);
    return () => { clearInterval(tick); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries, auto]);

  return (
    <div className="panel mx-auto mt-10 max-w-xl p-8" data-page-error="">
      <div className="label">{auto ? "One moment" : "Something went wrong"}</div>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold">
        {db ? "Can't reach the database" : auto ? "Loading is taking longer than usual" : "This page didn't load"}
      </h1>
      <p className="mt-3 text-[14px] text-ink-2">
        {db ? "Check the DATABASE_URL setting in Vercel (Project → Settings → Environment Variables). Use Supabase's Transaction pooler address (port 6543) with your real password, then redeploy."
          : auto ? `The database is busy for a moment. Trying again in ${left} s…`
          : "The database is busy right now (usually background work finishing). Try again in a minute."}
      </p>
      {error.digest && <p className="mt-3 font-mono text-[11px] text-ink-3">ref {error.digest}</p>}
      <button onClick={retry} className="mt-5 rounded-xl border border-line px-4 py-2 text-[14px] hover:border-accent/50">Try again now</button>
    </div>
  );
}
