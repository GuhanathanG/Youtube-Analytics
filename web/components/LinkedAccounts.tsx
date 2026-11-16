"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ExternalLink, Link2, Plus } from "lucide-react";
import type { LinkedAccount } from "@/lib/linked";
import { trackLinkedInstagram } from "@/app/actions";

const NAME = { instagram: "Instagram", facebook: "Facebook", x: "X", tiktok: "TikTok", threads: "Threads" } as const;
const TINT = { instagram: "#e1306c", facebook: "#1877f2", x: "#c9ced6", tiktok: "#25f4ee", threads: "#c9ced6" } as const;

/** Social accounts the creator lists on YouTube: track an Instagram one in one click (and pair it with this channel). */
export function LinkedAccounts({ channelId, accounts }: { channelId: string; accounts: LinkedAccount[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  if (!accounts.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-4" data-linked-accounts>
      <div className="label mb-2 flex items-center gap-1.5"><Link2 size={13} />Linked accounts (from the YouTube description)</div>
      <ul className="flex flex-wrap gap-2">
        {accounts.map((a) => {
          const key = `${a.platform}:${a.handle}`;
          const tracked = a.trackedId !== null || done.has(key);
          return (
            <li key={key} className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-3 py-1.5 text-[13px]">
              <span className="h-2 w-2 rounded-full" style={{ background: TINT[a.platform] }} />
              <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-ink hover:text-accent"
                title={a.label ?? undefined}>{NAME[a.platform]} @{a.handle}<ExternalLink size={11} /></a>
              {a.label && <span className="hidden max-w-[180px] truncate text-[11.5px] text-ink-3 sm:inline">{a.label}</span>}
              {a.platform === "instagram" && (tracked && (a.linked || done.has(key))
                ? <Link href={`/channels/ig_${a.handle}`} className="flex items-center gap-1 text-[12px] text-good"><Check size={13} />Tracked</Link>
                : <button disabled={pending} onClick={() => { setBusy(key); start(async () => {
                    const r = await trackLinkedInstagram(channelId, a.handle);
                    setMsg(r); if (r.ok) setDone((d) => new Set(d).add(key)); setBusy(null); }); }}
                    className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-[#f58529] via-[#dd2a7b] to-[#8134af] px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-60">
                    {tracked ? <><Link2 size={12} />{busy === key ? "Linking…" : "Link"}</> : <><Plus size={12} />{busy === key ? "Starting…" : "Track"}</>}
                  </button>)}
            </li>
          );
        })}
      </ul>
      {msg && <p className={`mt-2 text-[12.5px] ${msg.ok ? "text-accent" : "text-neg"}`} aria-live="polite">{msg.message}</p>}
    </div>
  );
}
