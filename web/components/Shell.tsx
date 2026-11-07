"use client";

import { BrainCircuit, ChartNoAxesCombined, Clapperboard, Gauge, Radar, Rocket, GitCompareArrows, LayoutDashboard, Lightbulb, LogOut, Menu, MessageSquareText, Search, Settings2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { logout, setFocus } from "@/app/actions";
import { CommandPalette } from "./CommandPalette";
import { LivePill } from "./LivePill";
import { Logo } from "./Logo";

type NavChannel = { id: string; title: string; thumb: string | null; active: boolean; rival?: boolean };

const NAV = [
  { href: "/command", label: "Command", icon: Rocket },
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/studio", label: "Studio", icon: Clapperboard },
  { href: "/ask", label: "Ask AI", icon: Sparkles },
  { href: "/comments", label: "Comments", icon: MessageSquareText },
  { href: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { href: "/predict", label: "Predict", icon: BrainCircuit },
  { href: "/radar", label: "Radar", icon: Radar },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/manage", label: "Manage", icon: Settings2 },
  { href: "/glance", label: "Glance", icon: Gauge },
];
// The phone bar has room for four items plus search.
const MOBILE_NAV = NAV.filter((n) => ["/command", "/", "/ask", "/comments"].includes(n.href));

/** Which channel the whole site shows. Switching reloads the page's data for that channel only. */
function FocusSwitcher({ channels, focus }: { channels: NavChannel[]; focus: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = channels.filter((c) => c.active && !c.rival); // competitors are on the Radar, not in the switcher
  if (active.length < 2) return null;
  return (
    <select aria-label="Channel shown across the site" value={focus ?? "all"} disabled={pending}
      onChange={(e) => { const v = e.target.value; start(async () => { await setFocus(v); router.refresh(); }); }}
      className="h-10 min-w-0 flex-1 truncate rounded-xl border border-accent/40 bg-accent/10 px-3 text-[13.5px] text-ink outline-none sm:max-w-[240px] sm:flex-none">
      {active.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      <option value="all">All channels (combined)</option>
    </select>
  );
}

export function Shell({ children, channels, focus }: { children: ReactNode; channels: NavChannel[]; focus: string | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
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
              {!c.active ? <span className="ml-auto text-[10px] text-ink-3">paused</span> : c.rival ? <span className="ml-auto font-mono text-[9.5px] tracking-wider text-accent-2">RIVAL</span> : null}
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
      <header className="safe-top sticky top-0 z-20 flex h-16 box-content items-center gap-3 border-b border-line bg-[#05070d]/60 px-4 backdrop-blur-xl sm:px-8">
        <Link href="/" className="shrink-0 lg:hidden" aria-label="Overview"><Logo size={28} compact /></Link>
        <FocusSwitcher channels={channels} focus={focus} />
        <button onClick={() => setOpen(true)}
          aria-label="Search" className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center gap-3 rounded-xl border border-line bg-white/[0.03] px-3 text-[13.5px] text-ink-3 transition hover:border-line-2 hover:text-ink-2 sm:w-full sm:max-w-[420px] sm:justify-start lg:ml-0">
          <Search size={16} className="shrink-0" /><span className="hidden sm:inline">Search channels, videos…</span>
          <kbd className="ml-auto hidden rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[11px] sm:inline">⌘K</kbd>
        </button>
        <LivePill />
      </header>

      <main className="safe-main mx-auto max-w-[1400px] px-4 pt-6 sm:px-8 sm:pt-8">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="safe-bottom fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-2xl border border-line-2 bg-[#0a0e1a]/85 p-1.5 backdrop-blur-xl lg:hidden">
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] ${isActive(href) ? "bg-white/[0.07] text-ink" : "text-ink-3"}`}>
            <Icon size={18} className={isActive(href) ? "text-accent" : ""} />{label}
          </Link>
        ))}
        <button onClick={() => setMore(true)} aria-expanded={more} aria-label="More pages"
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] ${more || !MOBILE_NAV.some((n) => isActive(n.href)) ? "bg-white/[0.07] text-ink" : "text-ink-3"}`}>
          <Menu size={18} />More
        </button>
      </nav>

      {/* Phone: every page, so nothing is hidden behind the 5-button bar */}
      {more && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="All pages">
          <button aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMore(false)} />
          <div className="safe-bottom absolute inset-x-3 bottom-3 rounded-2xl border border-line-2 bg-[#0a0e1a] p-3 shadow-2xl">
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="label">All pages</span>
              <button onClick={() => setMore(false)} aria-label="Close menu" className="rounded-lg p-1.5 text-ink-3 hover:text-ink"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} onClick={() => setMore(false)}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-[12.5px] ${isActive(href) ? "border-accent/40 bg-accent/10 text-ink" : "border-line text-ink-2"}`}>
                  <Icon size={19} className={isActive(href) ? "text-accent" : ""} />{label}
                </Link>
              ))}
              <button onClick={() => { setMore(false); setOpen(true); }}
                className="flex flex-col items-center gap-1 rounded-xl border border-line px-2 py-3 text-[12.5px] text-ink-2">
                <Search size={19} />Search
              </button>
              <form action={logout} className="contents">
                <button className="flex flex-col items-center gap-1 rounded-xl border border-line px-2 py-3 text-[12.5px] text-ink-2">
                  <LogOut size={19} />Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={open} setOpen={setOpen} />
    </div>
  );
}
