"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Topic in, plan out. Suggestions come from what viewers ask for and the channel's breakouts. */
export function StudioForm({ channelId, suggestions }: { channelId: string; suggestions: string[] }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    setMsg("");
    const r = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "plan", channelId, topic }) }).then((x) => x.json()).catch(() => ({ ok: false })) as { ok: boolean; id?: number; message?: string };
    if (r.ok && r.id) router.push(`/studio?d=${r.id}`); else setMsg(r.message ?? "Couldn't create the plan.");
  });
  return (
    <div>
      <label htmlFor="topic" className="label">Video idea</label>
      <textarea id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} maxLength={500}
        placeholder="e.g. Budget phone camera test under ₹20,000"
        className="mt-2 w-full rounded-xl border border-line-2 bg-black/30 px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/60" />
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Ideas from your audience">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setTopic(s)} className="chip hover:border-accent/50 hover:text-ink">{s.length > 48 ? s.slice(0, 47) + "…" : s}</button>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button onClick={go} disabled={pending || topic.trim().length < 3} className="btn-neon disabled:opacity-50">
          <Sparkles size={15} className={pending ? "animate-spin" : ""} />{pending ? "Planning… (about 20 s)" : "Plan this video"}
        </button>
        {msg && <span className="text-[13px] text-neg" aria-live="polite">{msg}</span>}
      </div>
    </div>
  );
}
