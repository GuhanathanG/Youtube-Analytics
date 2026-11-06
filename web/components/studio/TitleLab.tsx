"use client";

import { Gauge, Wand2 } from "lucide-react";
import { useState, useTransition } from "react";
import type { TitleScore } from "@/lib/packaging";
import { TitleScoreCard } from "./TitleScoreCard";

/** Packaging Lab: paste title ideas (one per line), score them against this channel's winners, ask the AI to improve one. */
async function call(body: Record<string, unknown>): Promise<TitleScore[]> {
  const r = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((x) => x.json()).catch(() => null) as { scores?: TitleScore[] } | null;
  return r?.scores ?? [];
}

export function TitleLab({ channelId }: { channelId: string }) {
  const [text, setText] = useState("");
  const [scores, setScores] = useState<TitleScore[]>([]);
  const [better, setBetter] = useState<{ from: string; list: TitleScore[] } | null>(null);
  const [pending, start] = useTransition();
  const [improving, startImprove] = useTransition();
  return (
    <div>
      <label htmlFor="titles" className="label">Title ideas · one per line</label>
      <textarea id="titles" value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder={"I tested 5 budget phones for a week\nBest camera phone under ₹20,000?"}
        className="mt-2 w-full rounded-xl border border-line-2 bg-black/30 px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/60" />
      <button onClick={() => start(async () => { setBetter(null); setScores(await call({ action: "score", channelId, titles: text.split("\n") })); })}
        disabled={pending || !text.trim()} className="btn-neon mt-3 disabled:opacity-50"><Gauge size={15} />{pending ? "Scoring…" : "Score titles"}</button>
      {scores.length > 0 && (
        <div className="mt-5 space-y-2.5">
          {scores.map((t, k) => (
            <div key={t.title}>
              <TitleScoreCard t={t} rank={k + 1} />
              <button onClick={() => startImprove(async () => setBetter({ from: t.title, list: await call({ action: "rewrite", channelId, title: t.title }) }))}
                disabled={improving} className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline disabled:opacity-50">
                <Wand2 size={13} />{improving && better?.from !== t.title ? "Improving…" : "Improve with AI"}
              </button>
              {better?.from === t.title && (
                <div className="mt-2 space-y-2 border-l border-accent/30 pl-3">
                  {better.list.length ? better.list.map((b, j) => <TitleScoreCard key={b.title} t={b} rank={j + 1} />)
                    : <p className="text-[12.5px] text-ink-3">The AI is busy right now; try again in a minute.</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
