"use client";

import { ArrowUp, Heart, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { askAction } from "@/app/actions";
import type { AskAnswer } from "@/lib/ask";

const EXAMPLES = [
  "What do viewers dislike about the recent videos?",
  "What content are people asking for next?",
  "How do Tamil-speaking viewers feel compared with English ones?",
  "What questions do viewers keep asking that nobody answers?",
];

/** Tiny renderer for the AI's answer: paragraphs, bullet lists, **bold**, and [n] citation links. */
function renderAnswer(text: string): ReactNode {
  const inline = (line: string, key: string) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
    return <span key={key}>{parts.map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="text-ink">{p.slice(2, -2)}</strong>;
      const m = /^\[(\d+)\]$/.exec(p);
      if (m) return <a key={i} href={`#cite-${m[1]}`} className="mx-0.5 rounded bg-accent/15 px-1 text-[11px] font-medium text-accent hover:bg-accent/25">{m[1]}</a>;
      return p;
    })}</span>;
  };
  const blocks = text.split(/\n{2,}/);
  return blocks.map((b, bi) => {
    const lines = b.split("\n").filter(Boolean);
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return <ul key={bi} className="my-2 space-y-1.5">{lines.map((l, li) => (
        <li key={li} className="flex gap-2.5"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{inline(l.replace(/^\s*[-*•]\s+/, ""), `${bi}-${li}`)}</li>
      ))}</ul>;
    }
    return <p key={bi} className="my-2">{lines.map((l, li) => <span key={li}>{inline(l.replace(/^#+\s*/, ""), `${bi}-${li}`)}{li < lines.length - 1 && <br />}</span>)}</p>;
  });
}

export function AskBox({ channels }: { channels: { id: string; title: string }[] }) {
  const [question, setQuestion] = useState("");
  const [channel, setChannel] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AskAnswer | { error: string } | null>(null);
  const [asked, setAsked] = useState("");

  const ask = (q: string) => {
    if (!q.trim() || pending) return;
    setAsked(q); setResult(null);
    start(async () => setResult(await askAction(q, channel || null)));
  };

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); ask(question); }} className="panel p-3">
        <div className="flex items-end gap-2">
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={500}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(question); } }}
            placeholder="Ask anything about the comments… e.g. What do people say about the audio?"
            className="min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3" />
          <button disabled={pending || !question.trim()} aria-label="Ask"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-r from-accent to-accent-2 text-[#05070d] transition hover:brightness-110 disabled:opacity-40">
            <ArrowUp size={18} />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line px-2 pt-2.5">
          <select value={channel} onChange={(e) => setChannel(e.target.value)}
            className="h-8 rounded-lg border border-line bg-[#0a0e1a] px-2 text-[12.5px] text-ink-2 outline-none">
            <option value="">All channels</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <span className="text-[12px] text-ink-3">Answers come only from stored comments, with links to them.</span>
        </div>
      </form>

      {!asked && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => { setQuestion(e); ask(e); }}
              className="rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-left text-[13.5px] text-ink-2 transition hover:border-accent/40 hover:text-ink">
              {e}
            </button>
          ))}
        </div>
      )}

      {asked && (
        <section className="panel mt-5 p-6">
          <div className="label">Question</div>
          <p className="mt-1 text-[15px] text-ink">{asked}</p>
          <div className="mt-5 flex items-center gap-2 text-[14px] font-semibold"><Sparkles size={16} className="text-accent" />Answer</div>
          {pending && (
            <div className="mt-3 space-y-2" aria-busy>
              <p className="text-[13px] text-ink-3">Searching comments in every language, then reading them… (10–30 s)</p>
              {[90, 75, 82].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-white/[0.06]" style={{ width: `${w}%` }} />)}
            </div>
          )}
          {result && "error" in result && <p className="mt-3 text-[14px] text-warn">{result.error}</p>}
          {result && "answer" in result && (
            <>
              <div className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{renderAnswer(result.answer)}</div>
              <p className="mt-3 text-[12px] text-ink-3">
                {result.searched.length ? `Searched for: ${result.searched.join(", ")} · ` : ""}{result.model}
              </p>
              {result.citations.length > 0 && (
                <div className="mt-5">
                  <div className="label mb-2">Comments cited</div>
                  <ol className="space-y-2">
                    {result.citations.map((c) => (
                      <li key={c.n} id={`cite-${c.n}`} className="scroll-mt-24 rounded-xl border border-line bg-white/[0.02] p-3 text-[13.5px]">
                        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                          <span className="rounded bg-accent/15 px-1.5 font-medium text-accent">{c.n}</span>
                          <span className="text-ink-2">{c.author ?? "Viewer"}</span>
                          <span className="flex items-center gap-1"><Heart size={11} />{c.likes.toLocaleString("en")}</span>
                          <Link href={`/videos/${c.video_id}`} className="truncate hover:text-accent">on {c.video_title}</Link>
                        </div>
                        <p className="mt-1.5 text-ink">{c.text}</p>
                        {c.translation && <p className="mt-1 border-l border-accent/40 pl-2 text-[12.5px] italic text-ink-2">{c.translation}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
