"use client";

import { LayoutDashboard, LogOut, MessageSquareText, Search, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logout } from "@/app/actions";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";

type NavChannel = { id: string; title: string; thumb: string | null; active: boolean };

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/comments", label: "Comments", icon: MessageSquareText },
  { href: "/manage", label: "Manage", icon: Settings2 },
];

export function Shell({ children, channels, status }:
  { children: ReactNode; channels: NavChannel[]; status: { lastSync: string; quota: number; healthy: boolean } }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="min-h-dvh lg:pl-[260px]">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-line bg-[#05070d]/70 px-4 py-5 backdrop-blur-xl lg:flex">
        <Link href="/" className="px-2"><Logo /></Link>
        <nav className="mt-8 space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${isActive(href) ? "bg-white/[0.06] text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"}`}>
              {isActive(href) && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent shadow-[0_0_12px_#22d3ee]" />}
              <Icon size={17} className={isActive(href) ? "text-accent" : ""} />{label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 px-3 label">Watching</div>
        <div className="scrollbar-thin mt-2 flex-1 space-y-0.5 overflow-y-auto">
          {channels.length === 0 && <p className="px-3 py-2 text-[13px] text-ink-3">No channels yet.</p>}
          {channels.map((c) => (
            <Link key={c.id} href={`/channels/${c.id}`}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition ${path === `/channels/${c.id}` ? "bg-white/[0.06] text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"}`}>
              {c.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumb} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-white/10" />
              ) : <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-[11px]">{c.title.slice(0, 1)}</span>}
              <span className="truncate">{c.title}</span>
              {!c.active && <span className="ml-auto text-[10px] text-ink-3">paused</span>}
            </Link>
          ))}
        </div>
        <form action={logout}>
          <button className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-ink-3 hover:bg-white/[0.04] hover:text-ink-2">
            <LogOut size={15} />Sign out
          </button>
        </form>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-[#05070d]/60 px-4 backdrop-blur-xl sm:px-8">
        <Link href="/" className="lg:hidden"><Logo size={24} /></Link>
        <button onClick={() => setOpen(true)}
          className="ml-auto flex h-10 w-full max-w-[420px] items-center gap-3 rounded-xl border border-line bg-white/[0.03] px-3 text-[13.5px] text-ink-3 transition hover:border-line-2 hover:text-ink-2 lg:ml-0">
          <Search size={16} /><span className="sm:hidden">Search</span><span className="hidden sm:inline">Search channels, videos…</span>
          <kbd className="ml-auto hidden rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[11px] sm:inline">⌘K</kbd>
        </button>
        <div className="ml-auto hidden items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-ink-2 sm:flex"
          title={`YouTube quota today: ${status.quota.toLocaleString("en")} / 10,000`}>
          <span className={`h-2 w-2 rounded-full ${status.healthy ? "bg-accent animate-[pulse-dot_2s_ease-out_infinite]" : "bg-warn"}`} />
          Synced {status.lastSync}
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-6 sm:px-8 sm:pt-8 lg:pb-16">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-2xl border border-line-2 bg-[#0a0e1a]/85 p-1.5 backdrop-blur-xl lg:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] ${isActive(href) ? "bg-white/[0.07] text-ink" : "text-ink-3"}`}>
            <Icon size={18} className={isActive(href) ? "text-accent" : ""} />{label}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] text-ink-3">
          <Search size={18} />Search
        </button>
      </nav>

      <CommandPalette open={open} setOpen={setOpen} />
    </div>
  );
}
