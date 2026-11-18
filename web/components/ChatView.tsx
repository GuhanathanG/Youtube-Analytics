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
      if (m) return <a key={i} href={`#${anchor}-${m[1]}`} className="mx-0.5 bg-accent/15 px-1 font-mono text-[10.5px] text-accent hover:bg-accent hover:text-bg">{m[1]}</a>;
      return p;
    })}</span>;
  };
  return text.split(/\n{2,}/).map((b, bi) => {
    const lines = b.split("\n").filter(Boolean);
    if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return <ul key={bi} className="my-2 space-y-1.5">{lines.map((l, li) => (
        <li key={li} className="flex gap-2.5"><span className="mt-[10px] h-1 w-1 shrink-0 bg-accent shadow-[0_0_6px_#22e1ff]" />{inline(l.replace(/^\s*[-*•]\s+/, ""), `${bi}-${li}`)}</li>
      ))}</ul>;
    }
    return <p key={bi} className="my-2">{lines.map((l, li) => <span key={li}>{inline(l.replace(/^#+\s*/, ""), `${bi}-${li}`)}{li < lines.length - 1 && <br />}</span>)}</p>;
  });
}

/**
 * The comments an answer used, drawn as a constellation: a glowing core (the answer) with each cited comment as a
 * star on the ring, bigger and closer the more likes it has. Click a star to jump to the comment.
 */
function Constellation({ citations, anchor }: { citations: ChatMessage["citations"]; anchor: string }) {
  const S = 220, c = S / 2;
  const maxL = Math.max(1, ...citations.map((x) => x.likes));
  const pts = citations.map((x, i) => {
    const a = (i / citations.length) * Math.PI * 2 - Math.PI / 2;
    const pull = Math.log1p(x.likes) / Math.log1p(maxL); // 0..1
    const r = 92 - pull * 34;
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r, size: 3 + pull * 4, n: x.n, who: x.author ?? "Viewer", likes: x.likes };
  });
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} className="constellation shrink-0" role="img" aria-label={`${citations.length} cited comments`}>
      <circle cx={c} cy={c} r={92} fill="none" stroke="rgba(255,255,255,.07)" />
      <circle cx={c} cy={c} r={58} fill="none" stroke="rgba(255,255,255,.05)" />
      {pts.map((p, i) => <line key={`l${p.n}`} x1={c} y1={c} x2={p.x} y2={p.y} stroke="#22e1ff" strokeOpacity={0.28} strokeWidth={1} className="cl-line" style={{ animationDelay: `${i * 60}ms` }} />)}
      <circle cx={c} cy={c} r={14} fill="#22e1ff" opacity={0.15} /><circle cx={c} cy={c} r={5} fill="#fff" style={{ filter: "drop-shadow(0 0 6px #22e1ff)" }} />
      {pts.map((p, i) => (
        <a key={p.n} href={`#${anchor}-${p.n}`} className="cl-star" style={{ animationDelay: `${200 + i * 60}ms` }}>
          <title>{`${p.n}. ${p.who} · ${p.likes} likes`}</title>
          <circle cx={p.x} cy={p.y} r={p.size + 6} fill="transparent" />
          <circle cx={p.x} cy={p.y} r={p.size} fill="#22e1ff" style={{ filter: "drop-shadow(0 0 5px #22e1ff)" }} />
          <text x={p.x} y={p.y - p.size - 5} textAnchor="middle" fontSize={9} fill="#b4b4bb" fontFamily="var(--f-mono)">{p.n}</text>
        </a>
      ))}
    </svg>
  );
}

function Answer({ m }: { m: ChatMessage }) {
  const anchor = `m${m.id}`;
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent"><Sparkles size={12} />Answer{m.model ? <span className="text-ink-3">· {m.model}</span> : null}</div>
      <div className="min-w-0">
        <div className="text-[15.5px] leading-[1.75] text-ink-2">{renderAnswer(m.content, anchor)}</div>
        {m.citations.length > 0 && (
          <details className="mt-4 border-t border-line pt-4" open>
            <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink-2">{m.citations.length} comment{m.citations.length === 1 ? "" : "s"} cited{m.searched.length ? ` · searched: ${m.searched.slice(0, 6).join(", ")}` : ""}</summary>
            <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-start">
            <Constellation citations={m.citations} anchor={anchor} />
            <ol className="min-w-0 flex-1 space-y-2">
              {m.citations.map((c) => (
                <li key={c.n} id={`${anchor}-${c.n}`} className="scroll-mt-28 border border-line bg-white/[0.015] p-3.5 text-[13.5px] target:border-accent">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                    <span className="bg-accent/15 px-1.5 font-mono text-accent">{c.n}</span>
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
        className="mb-3 flex items-center gap-2 rounded-full border border-accent/50 px-4 py-2 text-[13px] text-accent transition hover:bg-accent hover:text-bg">
        <MessageSquarePlus size={16} />New chat
      </Link>
      {threads.length === 0 && <p className="px-2 text-[12.5px] text-ink-3">Your conversations will be saved here.</p>}
      {threads.map((t) => (
        <div key={t.id} className={`group flex items-center gap-1 border-l-2 px-2.5 ${t.id === threadId ? "border-accent bg-white/[0.04]" : "border-transparent hover:bg-white/[0.03]"}`}>
          <Link href={`/ask?t=${t.id}`} onClick={() => setShowHistory(false)} className="min-w-0 flex-1 py-2">
            <div className="truncate text-[13.5px] text-ink">{t.title}</div>
            <div className="truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">{channelName(t.channel_id)} / {t.messages} messages</div>
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
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs overflow-y-auto border-r border-line-2 bg-[#0b0b10] p-4">
            <div className="mb-3 flex items-center justify-between"><span className="label">Conversations</span>
              <button aria-label="Close conversations" onClick={() => setShowHistory(false)}><X size={18} className="text-ink-3" /></button></div>
            {sidebar}
          </div>
        </div>
      )}

      <section className="min-w-0">
        <div className="mb-3 flex items-center gap-2 lg:hidden">
          <button onClick={() => setShowHistory(true)} className="inline-flex items-center gap-2 rounded-full border border-line-2 px-3.5 py-2 text-[13px] text-ink-2"><History size={15} />Conversations</button>
          <Link href="/ask" className="inline-flex items-center gap-2 rounded-full border border-line-2 px-3.5 py-2 text-[13px] text-ink-2"><MessageSquarePlus size={15} />New</Link>
        </div>

        {messages.length === 0 ? (
          <div className="mb-5 grid border-l border-t border-line sm:grid-cols-2">
            {EXAMPLES.map((e, i) => (
              <button key={e} onClick={() => send(e)}
                className="group border-b border-r border-line px-5 py-5 text-left transition hover:bg-white/[0.03]">
                <span className="font-mono text-[10px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                <span className="mt-2 block text-[14.5px] leading-snug text-ink-2 transition group-hover:text-ink">{e}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-5 space-y-8 border border-line p-5 sm:p-8" aria-live="polite">
            {threadId && <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">■ About: {channelName(threadChannel)}</div>}
            {messages.map((m) => m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] border border-accent/40 bg-accent/[0.06] px-4 py-3">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent">You</div>
                  <div className="mt-1 text-[15px] text-ink">{m.content}</div>
                </div>
              </div>
            ) : <Answer key={m.id} m={m} />)}
            {pending && (
              <div className="font-mono text-[12.5px] leading-7 text-ink-3" aria-busy>
                <div><span className="text-accent">&gt;</span> searching every stored comment, in every language</div>
                <div><span className="text-accent">&gt;</span> reading the creator memory</div>
                <div><span className="text-accent">&gt;</span> writing the answer (10–30 s) <span className="term-cursor" /></div>
              </div>
            )}
            <div ref={end} />
          </div>
        )}
        {error && <p className="mb-3 text-[14px] text-warn">{error}</p>}

        <form onSubmit={(e) => { e.preventDefault(); send(question); }} className="sticky bottom-24 border border-line-2 bg-[#07070a]/95 p-3 backdrop-blur-xl focus-within:border-accent/60 lg:bottom-4">
          <div className="flex items-end gap-2">
            <span className="pb-3 pl-2 font-mono text-[15px] text-accent" aria-hidden>&gt;</span>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={1000}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(question); } }}
              aria-label={threadId ? "Your follow-up question" : "Your question about the comments"}
              placeholder={threadId ? "Ask a follow-up…" : "Ask anything about the comments… e.g. What do people say about the audio?"}
              className="min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3" />
            <button disabled={pending || question.trim().length < 2} aria-label="Send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-bg transition hover:shadow-[0_0_24px_rgba(34,225,255,.55)] disabled:opacity-30">
              <ArrowUp size={18} />
            </button>
          </div>
          {!threadId && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line px-2 pt-2.5">
              <select aria-label="Which channel" value={channel} onChange={(e) => setChannel(e.target.value)}
                className="h-8 rounded-md border border-line-2 bg-[#0b0b10] px-2 text-[12.5px] text-ink-2 outline-none">
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
