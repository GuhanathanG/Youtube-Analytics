"use client";

import { ArrowUp, Heart, History, MessageSquarePlus, Pencil, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { chatAction, deleteChatAction, renameChatAction } from "@/app/actions";
import type { ChatMessage, Thread } from "@/lib/chat";

const EXAMPLES = [
  "What do viewers dislike about the recent videos?",
  "What content are people asking for next?",
  "How has this audience changed over the last few months?",
  "What questions do viewers keep asking that nobody answers?",
];

/** Tiny renderer for the AI's answer: paragraphs, bullet lists, **bold**, and [n] citation links. */
function renderAnswer(text: string, anchor: string): ReactNode {
  const inline = (line: string, key: string) => {
    const parts = line.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
    return <span key={key}>{parts.map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="text-ink">{p.slice(2, -2)}</strong>;
      const m = /^\[(\d+)\]$/.exec(p);
      if (m) return <a key={i} href={`#${anchor}-${m[1]}`} className="mx-0.5 rounded bg-accent/15 px-1 text-[11px] font-medium text-accent hover:bg-accent/25">{m[1]}</a>;
      return p;
    })}</span>;
  };
  return text.split(/\n{2,}/).map((b, bi) => {
    const lines = b.split("\n").filter(Boolean);
    if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return <ul key={bi} className="my-2 space-y-1.5">{lines.map((l, li) => (
        <li key={li} className="flex gap-2.5"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{inline(l.replace(/^\s*[-*•]\s+/, ""), `${bi}-${li}`)}</li>
      ))}</ul>;
    }
    return <p key={bi} className="my-2">{lines.map((l, li) => <span key={li}>{inline(l.replace(/^#+\s*/, ""), `${bi}-${li}`)}{li < lines.length - 1 && <br />}</span>)}</p>;
  });
}

function Answer({ m }: { m: ChatMessage }) {
  const anchor = `m${m.id}`;
  return (
    <div className="flex gap-3">
      <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent/30 to-accent-2/30"><Sparkles size={14} className="text-accent" /></div>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] leading-relaxed text-ink-2">{renderAnswer(m.content, anchor)}</div>
        {m.citations.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[12.5px] text-ink-3 hover:text-ink-2">{m.citations.length} comment{m.citations.length === 1 ? "" : "s"} cited{m.searched.length ? ` · searched: ${m.searched.slice(0, 6).join(", ")}` : ""}</summary>
            <ol className="mt-2 space-y-2">
              {m.citations.map((c) => (
                <li key={c.n} id={`${anchor}-${c.n}`} className="scroll-mt-24 rounded-xl border border-line bg-white/[0.02] p-3 text-[13.5px]">
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
          </details>
        )}
      </div>
    </div>
  );
}

export function ChatView({ threads, threadId, messages: initial, channels, threadChannel }: {
  threads: Thread[]; threadId: string | null; messages: ChatMessage[];
  channels: { id: string; title: string }[]; threadChannel: string | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [question, setQuestion] = useState("");
  const [channel, setChannel] = useState(threadChannel ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [showHistory, setShowHistory] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => setMessages(initial), [initial]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, pending]);

  const send = (q: string) => {
    const text = q.trim();
    if (text.length < 2 || pending) return;
    setError(""); setQuestion("");
    setMessages((m) => [...m, { id: -Date.now(), role: "user", content: text, citations: [], searched: [], model: null, created_at: new Date().toISOString() }]);
    start(async () => {
      const res = await chatAction(threadId, text, threadId ? null : channel || null);
      if ("error" in res && res.error) { setError(res.error); return; }
      if ("threadId" in res && res.threadId !== threadId) router.push(`/ask?t=${res.threadId}`);
      else router.refresh();
    });
  };

  const channelName = (id: string | null) => channels.find((c) => c.id === id)?.title ?? "All channels";

  const sidebar = (
    <nav aria-label="Saved conversations" className="space-y-1">
      <Link href="/ask" onClick={() => setShowHistory(false)}
        className="mb-2 flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-[13.5px] text-accent hover:bg-accent/15">
        <MessageSquarePlus size={16} />New chat
      </Link>
      {threads.length === 0 && <p className="px-2 text-[12.5px] text-ink-3">Your conversations will be saved here.</p>}
      {threads.map((t) => (
        <div key={t.id} className={`group flex items-center gap-1 rounded-xl px-2 ${t.id === threadId ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}>
          <Link href={`/ask?t=${t.id}`} onClick={() => setShowHistory(false)} className="min-w-0 flex-1 py-2">
            <div className="truncate text-[13.5px] text-ink">{t.title}</div>
            <div className="truncate text-[11.5px] text-ink-3">{channelName(t.channel_id)} · {t.messages} messages</div>
          </Link>
          <button aria-label={`Rename "${t.title}"`} className="rounded p-1 text-ink-3 opacity-60 hover:text-ink group-hover:opacity-100"
            onClick={async () => { const name = prompt("Rename conversation", t.title); if (name) { await renameChatAction(t.id, name); router.refresh(); } }}>
            <Pencil size={13} /></button>
          <button aria-label={`Delete "${t.title}"`} className="rounded p-1 text-ink-3 opacity-60 hover:text-neg group-hover:opacity-100"
            onClick={async () => { if (confirm("Delete this conversation?")) { await deleteChatAction(t.id); if (t.id === threadId) router.push("/ask"); else router.refresh(); } }}>
            <Trash2 size={13} /></button>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="hidden lg:block"><div className="sticky top-20 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-1">{sidebar}</div></aside>
      {showHistory && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Saved conversations">
          <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={() => setShowHistory(false)} />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs overflow-y-auto border-r border-line-2 bg-[#0a0e1a] p-4">
            <div className="mb-3 flex items-center justify-between"><span className="label">Conversations</span>
              <button aria-label="Close conversations" onClick={() => setShowHistory(false)}><X size={18} className="text-ink-3" /></button></div>
            {sidebar}
          </div>
        </div>
      )}

      <section className="min-w-0">
        <div className="mb-3 flex items-center gap-2 lg:hidden">
          <button onClick={() => setShowHistory(true)} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13px] text-ink-2"><History size={15} />Conversations</button>
          <Link href="/ask" className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13px] text-ink-2"><MessageSquarePlus size={15} />New</Link>
        </div>

        {messages.length === 0 ? (
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((e) => (
              <button key={e} onClick={() => send(e)}
                className="rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-left text-[13.5px] text-ink-2 transition hover:border-accent/40 hover:text-ink">{e}</button>
            ))}
          </div>
        ) : (
          <div className="panel mb-4 space-y-6 p-5 sm:p-6" aria-live="polite">
            {threadId && <div className="text-[12px] text-ink-3">About: {channelName(threadChannel)}</div>}
            {messages.map((m) => m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-[14.5px] text-ink ring-1 ring-accent/25">{m.content}</div>
              </div>
            ) : <Answer key={m.id} m={m} />)}
            {pending && (
              <div className="flex gap-3" aria-busy>
                <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.06]"><Sparkles size={14} className="animate-pulse text-accent" /></div>
                <div className="flex-1 space-y-2">
                  <p className="text-[13px] text-ink-3">Reading the comments and the creator memory… (10–30 s)</p>
                  {[85, 70].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-white/[0.06]" style={{ width: `${w}%` }} />)}
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
        )}
        {error && <p className="mb-3 text-[14px] text-warn">{error}</p>}

        <form onSubmit={(e) => { e.preventDefault(); send(question); }} className="panel sticky bottom-24 p-3 lg:bottom-4">
          <div className="flex items-end gap-2">
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={1000}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(question); } }}
              aria-label={threadId ? "Your follow-up question" : "Your question about the comments"}
              placeholder={threadId ? "Ask a follow-up…" : "Ask anything about the comments… e.g. What do people say about the audio?"}
              className="min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3" />
            <button disabled={pending || question.trim().length < 2} aria-label="Send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-r from-accent to-accent-2 text-[#05070d] transition hover:brightness-110 disabled:opacity-40">
              <ArrowUp size={18} />
            </button>
          </div>
          {!threadId && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line px-2 pt-2.5">
              <select aria-label="Which channel" value={channel} onChange={(e) => setChannel(e.target.value)}
                className="h-8 rounded-lg border border-line bg-[#0a0e1a] px-2 text-[12.5px] text-ink-2 outline-none">
                <option value="">All channels</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <span className="text-[12px] text-ink-3">Answers come from stored comments and the creator memory, with links.</span>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
