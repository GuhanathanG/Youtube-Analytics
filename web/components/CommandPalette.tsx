"use client";

import { Command } from "cmdk";
import { ChartNoAxesCombined, GitCompareArrows, LayoutDashboard, Lightbulb, MessageSquareText, Search, Settings2, Sparkles, Tv, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Results = { channels: { id: string; title: string; handle: string | null }[]; videos: { id: string; title: string; channel: string }[] };

export function CommandPalette({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results>({ channels: [], videos: [] });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(!open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { channels: [], videos: [] })).then(setRes).catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  const go = (href: string) => { setOpen(false); setQ(""); router.push(href); };
  const item = "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-ink-2 aria-selected:bg-white/[0.07] aria-selected:text-ink";

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Search" shouldFilter={false}
      overlayClassName="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-2 bg-[#141416]/95 shadow-[0_30px_80px_-20px_rgba(200,169,126,0.25)] backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={18} className="text-accent" />
        <Command.Input value={q} onValueChange={setQ} placeholder="Search channels, videos, pages…"
          className="h-14 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
        <kbd className="rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-3">esc</kbd>
      </div>
      <Command.List className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-3">Nothing found.</Command.Empty>
        {!q && (
          <Command.Group heading="Go to">
            <Command.Item className={item} onSelect={() => go("/")}><LayoutDashboard size={16} />Overview</Command.Item>
            <Command.Item className={item} onSelect={() => go("/ask")}><Sparkles size={16} />Ask AI about comments</Command.Item>
            <Command.Item className={item} onSelect={() => go("/comments")}><MessageSquareText size={16} />Comment explorer</Command.Item>
            <Command.Item className={item} onSelect={() => go("/analytics")}><ChartNoAxesCombined size={16} />Advanced analytics</Command.Item>
            <Command.Item className={item} onSelect={() => go("/compare")}><GitCompareArrows size={16} />Compare channels</Command.Item>
            <Command.Item className={item} onSelect={() => go("/ideas")}><Lightbulb size={16} />Content ideas</Command.Item>
            <Command.Item className={item} onSelect={() => go("/manage")}><Settings2 size={16} />Manage channels</Command.Item>
          </Command.Group>
        )}
        {res.channels.length > 0 && (
          <Command.Group heading="Channels">
            {res.channels.map((c) => (
              <Command.Item key={c.id} value={`c-${c.id}`} className={item} onSelect={() => go(`/channels/${c.id}`)}>
                <Tv size={16} className="text-accent" /><span className="truncate">{c.title}</span><span className="ml-auto text-[12px] text-ink-3">{c.handle}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {res.videos.length > 0 && (
          <Command.Group heading="Videos">
            {res.videos.map((v) => (
              <Command.Item key={v.id} value={`v-${v.id}`} className={item} onSelect={() => go(`/videos/${v.id}`)}>
                <Video size={16} className="text-accent-2" /><span className="truncate">{v.title}</span><span className="ml-auto shrink-0 text-[12px] text-ink-3">{v.channel}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {q && (
          <Command.Item value="search-comments" className={item} onSelect={() => go(`/comments?q=${encodeURIComponent(q)}`)}>
            <MessageSquareText size={16} />Search comments for “{q}”
          </Command.Item>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
