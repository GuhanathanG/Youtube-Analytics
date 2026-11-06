"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const msg = error.message || "";
  const db = /DATABASE_URL|password authentication|ENOTFOUND|ECONNREFUSED|Tenant or user|timeout/i.test(msg);
  return (
    <div className="panel mx-auto mt-10 max-w-xl p-8">
      <div className="label">Something went wrong</div>
      <h1 className="mt-2 font-serif-display text-2xl">{db ? "Can't reach the database" : "This page hit an error"}</h1>
      <p className="mt-3 text-[14px] text-ink-2">
        {db ? "Check the DATABASE_URL setting in Vercel (Project → Settings → Environment Variables). Use Supabase's Transaction pooler address (port 6543) with your real password, then redeploy."
          : "Try again in a moment. If it keeps happening, the background run may still be setting up the database."}
      </p>
      {error.digest && <p className="mt-3 font-mono text-[11px] text-ink-3">ref {error.digest}</p>}
      <button onClick={reset} className="mt-5 rounded-xl border border-line px-4 py-2 text-[14px] hover:border-accent/50">Try again</button>
    </div>
  );
}
