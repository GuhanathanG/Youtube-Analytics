"use client";

import { Link2, Unlink } from "lucide-react";
import { useTransition } from "react";
import { disconnectChannel } from "@/app/actions";

type Conn = { channel_id: string; title: string | null; connected_at: string; pulled_at: string | null; error: string | null };

/** Manage → Connect your channel: sign in with Google (read-only) to unlock private YouTube Analytics. */
export function ConnectChannel({ configured, connections, notice }: { configured: boolean; connections: Conn[]; notice: { ok?: string; error?: string } }) {
  const [pending, start] = useTransition();
  return (
    <div>
      {notice.ok && <p className="mb-3 text-[13px] text-accent">Connected: {notice.ok}. Private numbers appear on its channel and video pages.</p>}
      {notice.error && <p className="mb-3 text-[13px] text-neg">{notice.error}</p>}
      {configured ? (
        <a href="/api/oauth/google/start" className="btn-neon"><Link2 size={15} />Connect a YouTube channel</a>
      ) : (
        <p className="text-[13px] text-ink-2">Needs a Google sign-in app: add <span className="font-mono">GOOGLE_CLIENT_ID</span> and <span className="font-mono">GOOGLE_CLIENT_SECRET</span> in Vercel (see docs/CONNECT_CHANNEL.md).</p>
      )}
      <p className="mt-3 text-[12.5px] text-ink-3">Read-only. Unlocks watch time, how much of each video people watch, subscribers gained, traffic sources and, where Google allows, impressions and click-through rate. Refreshed every 6 hours.</p>
      {connections.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {connections.map((c) => (
            <li key={c.channel_id} className="flex items-center gap-3 py-2.5 text-[13.5px]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_8px_#22d3ee]" />
              <span className="min-w-0 flex-1"><span className="block truncate text-ink">{c.title ?? c.channel_id}</span>
                <span className={`block truncate text-[12px] ${c.error ? "text-neg" : "text-ink-3"}`}>{c.error ?? (c.pulled_at ? "numbers up to date" : "waiting for the first pull")}</span></span>
              <button disabled={pending} onClick={() => start(() => disconnectChannel(c.channel_id))}
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"><Unlink size={12} />Disconnect</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
