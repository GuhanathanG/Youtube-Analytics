"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AnalyseButton({ videoId, again = false }: { videoId: string; again?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/video-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId }) });
      const j = await res.json();
      setMsg(j.message ?? j.error ?? null);
      if (j.ok) router.refresh();
    } catch { setMsg("Something went wrong. Try again in a minute."); }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={run} disabled={busy}
        className={again ? "inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-2 transition hover:border-accent/50 hover:text-ink disabled:opacity-50"
          : "inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 px-4 py-2.5 text-[14px] font-semibold text-[#05070d] transition hover:brightness-110 disabled:opacity-60"}>
        <Sparkles size={15} className={busy ? "animate-spin" : ""} />{busy ? "Watching the video… (1–3 min)" : again ? "Analyse again" : "Analyse this video with AI"}
      </button>
      {msg && <span className="text-[12.5px] text-ink-2">{msg}</span>}
    </div>
  );
}
