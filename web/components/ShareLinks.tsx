"use client";
import { Check, Copy, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createShareAction, revokeShareAction } from "@/app/actions";
import type { ShareLink } from "@/lib/share";

export function ShareLinks({ channels, links, site }: { channels: { id: string; title: string }[]; links: ShareLink[]; site: string }) {
  const [origin, setOrigin] = useState(site);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { if (!site) setOrigin(window.location.origin); }, [site]);
  const url = (t: string) => `${origin}/share/${t}`;
  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(url(t)); setCopied(t); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  };
  const live = (l: ShareLink) => !l.revoked && (!l.expires_at || new Date(l.expires_at + "Z") > new Date());
  return (
    <div className="space-y-4">
      <form action={createShareAction} className="flex flex-wrap items-center gap-2">
        <select name="channel" aria-label="Channel to share" className="h-10 rounded-xl border border-line-2 bg-[#0a0e1a] px-3 text-[13.5px] text-ink">
          {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select name="days" aria-label="Link stops working after" defaultValue="30" className="h-10 rounded-xl border border-line-2 bg-[#0a0e1a] px-3 text-[13.5px] text-ink">
          <option value="7">for 7 days</option><option value="30">for 30 days</option><option value="90">for 90 days</option><option value="0">until I turn it off</option>
        </select>
        <button className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent/15 px-4 text-[13.5px] text-accent ring-1 ring-accent/30 hover:bg-accent/25"><Link2 size={15} />Create link</button>
      </form>
      {links.length > 0 && (
        <ul className="divide-y divide-line">
          {links.map((l) => (
            <li key={l.token} className="flex flex-wrap items-center gap-2 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate"><span className="text-ink">{l.channel_title}</span>
                <span className="ml-2 text-ink-3">{live(l) ? (l.expires_at ? `until ${new Date(l.expires_at + "Z").toLocaleDateString("en-GB")}` : "no end date") : "off"} · {l.views} views</span></span>
              {live(l) && <>
                <button type="button" onClick={() => copy(l.token)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-ink-2 hover:text-ink">
                  {copied === l.token ? <Check size={13} /> : <Copy size={13} />}{copied === l.token ? "Copied" : "Copy link"}</button>
                <form action={revokeShareAction}><input type="hidden" name="token" value={l.token} />
                  <button className="rounded-lg border border-line px-2.5 py-1 text-ink-3 hover:border-neg/50 hover:text-neg">Turn off</button></form>
              </>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
