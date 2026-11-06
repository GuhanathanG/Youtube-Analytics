import Link from "next/link";
import { Radio } from "lucide-react";
import type { LiveChatStats } from "@/lib/livechat";
import { compact } from "@/lib/format";
import { MixBar } from "./charts/MixBar";
import { MiniStat } from "./AnalyticsParts";
import { Empty, Panel, Tag } from "./ui";

/** 1. Live chat of a stream or premiere. */
export function LiveChatPanel({ s }: { s: LiveChatStats }) {
  const max = Math.max(1, ...s.perMinute.map((m) => m.n));
  const bars = s.perMinute.slice(-120); // last 2 hours of minutes
  return (
    <Panel title={<span className="flex items-center gap-2"><Radio size={16} className={s.status === "live" ? "text-neg" : "text-ink-3"} />Live chat</span>}
      subtitle={s.status === "live" ? "Live now: read every 2 minutes while the stream is on" : s.status === "upcoming" ? "Scheduled: chat is captured once it starts" : "Captured while the stream was live (YouTube keeps no chat replay for apps)"}
      action={s.status === "live" ? <Tag tone="warn">● LIVE{s.viewers ? ` · ${compact(s.viewers)} watching` : ""}</Tag> : undefined}>
      {s.error ? <p className="text-[13px] text-ink-2">YouTube didn&apos;t allow reading this chat: {s.error}</p> : !s.messages ? <Empty>No chat messages captured yet.</Empty> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Messages" value={compact(s.messages)} hint={s.peak ? `peak ${s.peak.n}/min at ${s.peak.minute} UTC` : undefined} />
            <MiniStat label="Chatters" value={compact(s.chatters)} hint={s.members ? `${compact(s.members)} member message${s.members === 1 ? "" : "s"}` : undefined} />
            <MiniStat label="Questions" value={compact(s.questions)} />
            <MiniStat label="Super Chats" value={s.superChats.length ? s.superChats.map((c) => `${c.currency} ${c.total.toLocaleString("en", { maximumFractionDigits: 0 })}`).join(" · ") : "–"}
              hint={s.superChats.length ? (() => { const n = s.superChats.reduce((a, c) => a + c.count, 0); return `${n} paid message${n === 1 ? "" : "s"}`; })() : undefined} />
          </div>
          <div>
            <div className="label mb-2">Messages per minute</div>
            <div className="flex h-20 items-end gap-px" role="img" aria-label="Chat messages per minute">
              {bars.map((m) => <div key={m.minute} className="flex-1 rounded-t bg-accent/70" style={{ height: `${(m.n / max) * 100}%` }} title={`${m.minute} UTC: ${m.n}`} />)}
            </div>
          </div>
          <div><div className="label mb-2">Mood (short reactions)</div><MixBar mix={s.mood} size="sm" /></div>
          {s.summary?.summary && (
            <div className="rounded-xl border border-accent/25 bg-accent/5 p-4">
              <div className="label mb-1">AI summary of the chat</div>
              <p className="text-[13.5px] text-ink">{s.summary.summary}</p>
              {!!s.summary.highlights?.length && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">{s.summary.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>}
              {!!s.summary.requests?.length && <p className="mt-2 text-[13px] text-ink-2"><span className="text-ink-3">Asked for:</span> {s.summary.requests.join(" · ")}</p>}
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div><div className="label mb-2">Most active chatters</div>
              <ul className="space-y-1 text-[13px]">{s.topChatters.map((c) => <li key={c.name} className="flex justify-between"><span className="truncate text-ink-2">{c.name}</span><span className="tabular text-ink-3">{c.n}</span></li>)}</ul></div>
            <div><div className="label mb-2">Latest questions</div>
              {s.recentQuestions.length ? <ul className="space-y-1.5 text-[13px] text-ink-2">{s.recentQuestions.map((q, i) => <li key={i}>“{q.text}” <span className="text-ink-3">{q.author}</span></li>)}</ul> : <p className="text-[13px] text-ink-3">None yet.</p>}</div>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function LiveNowBanner({ live }: { live: { id: string; title: string; channel: string; viewers: number | null; messages: number }[] }) {
  if (!live.length) return null;
  return (
    <div className="panel mb-4 flex flex-wrap items-center gap-3 border-neg/40 p-4">
      <span className="flex items-center gap-2 text-[13px] font-semibold text-neg"><Radio size={16} />LIVE NOW</span>
      {live.map((l) => (
        <Link key={l.id} href={`/videos/${l.id}`} className="min-w-0 truncate rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink hover:border-neg/50">
          {l.channel}: {l.title} <span className="text-ink-3">· {l.viewers ? `${compact(l.viewers)} watching · ` : ""}{compact(l.messages)} chat</span>
        </Link>
      ))}
    </div>
  );
}
