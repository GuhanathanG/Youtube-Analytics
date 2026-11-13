"use client";

import { Activity, BrainCircuit, ChartNoAxesCombined, Clapperboard, Columns2, Flame, Gauge, GitCompareArrows, Globe, LayoutDashboard, Lightbulb,
  LogOut, MessageSquareText, Radar, Rocket, Search, Settings2, Sparkles, Target, TrendingUp, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { logout, setFocus } from "@/app/actions";
import dynamic from "next/dynamic";

// The search palette (and its library) loads the first time it's opened, not with every page.
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });
import { LivePill } from "./LivePill";
import { Logo } from "./Logo";
import { ACCOUNT_PAGES, HUBS, hubOf, pageMatches } from "@/lib/nav";

type NavChannel = { id: string; title: string; thumb: string | null; active: boolean; rival?: boolean };

const ICONS: Record<string, LucideIcon> = { Activity, BrainCircuit, ChartNoAxesCombined, Clapperboard, Columns2, Flame, Gauge, GitCompareArrows, Globe,
  LayoutDashboard, Lightbulb, MessageSquareText, Radar, Rocket, Search, Settings2, Sparkles, Target, TrendingUp, Users };
const Icon = ({ name, ...p }: { name: string; size?: number; className?: string }) => { const I = ICONS[name] ?? Activity; return <I {...p} />; };

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
  const [paletteUsed, setPaletteUsed] = useState(false); // keep it mounted after the first open (instant next time)
  useEffect(() => { if (open) setPaletteUsed(true); }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [account, setAccount] = useState(false);
  const hub = hubOf(path);

  return (
    <div className="min-h-dvh lg:pl-[260px]">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-line bg-[#05070d]/70 px-4 py-5 backdrop-blur-xl lg:flex">
        <Link href="/" className="px-2"><Logo /></Link>
        {/* Nav and the Watching list scroll together, so the channel list is never squeezed to nothing on short screens */}
        <div className="scrollbar-thin -mx-1 mt-6 min-h-0 flex-1 overflow-y-auto px-1">
        <nav className="space-y-1" aria-label="Hubs">
          {HUBS.map((h) => {
            const on = hub?.key === h.key;
            return (
              <div key={h.key}>
                <Link href={h.pages[0].href} title={h.question}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium transition ${on ? "bg-white/[0.06] text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"}`}>
                  {on && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: h.color, boxShadow: `0 0 12px ${h.color}` }} />}
                  <span className="grid h-7 w-7 place-items-center rounded-lg transition" style={on ? { background: `${h.color}22`, color: h.color, boxShadow: `0 0 14px -4px ${h.color}` } : undefined}>
                    <Icon name={h.icon} size={16} />
                  </span>
                  {h.label}
                </Link>
                {on && (
                  <div className="anim-slide-in ml-[26px] mt-0.5 space-y-0.5 border-l border-line pl-3">
                    {h.pages.map((p) => (
                      <Link key={p.href} href={p.href}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition ${pageMatches(p.href, path) ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                        <Icon name={p.icon} size={14} className={pageMatches(p.href, path) ? "text-accent" : ""} />{p.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="mt-6 px-3 label">Watching</div>
        <div className="mt-2 space-y-0.5 pb-2">
          {channels.length === 0 && <p className="px-3 py-2 text-[13px] text-ink-3">No channels yet.</p>}
          {channels.map((c) => (
            <Link key={c.id} href={`/channels/${c.id}`}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition ${path === `/channels/${c.id}` ? "bg-white/[0.06] text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"}`}>
              {c.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img decoding="async" src={c.thumb} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-white/10" />
              ) : <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-[11px]">{c.title.slice(0, 1)}</span>}
              <span className="truncate">{c.title}</span>
              {!c.active ? <span className="ml-auto text-[10px] text-ink-3">paused</span> : c.rival ? <span className="ml-auto font-mono text-[9.5px] tracking-wider text-accent-2">RIVAL</span> : null}
            </Link>
          ))}
        </div>
        </div>
        <div className="mt-3 flex gap-1 border-t border-line pt-3">
          {ACCOUNT_PAGES.map((p) => (
            <Link key={p.href} href={p.href} className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${pageMatches(p.href, path) ? "bg-white/[0.06] text-ink" : "text-ink-3 hover:bg-white/[0.04] hover:text-ink-2"}`}>
              <Icon name={p.icon} size={15} />Settings
            </Link>
          ))}
          <form action={logout}>
            <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-ink-3 hover:bg-white/[0.04] hover:text-ink-2"><LogOut size={15} />Sign out</button>
          </form>
        </div>
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
        <button onClick={() => setAccount(true)} aria-label="Settings and account" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-ink-3 hover:text-ink lg:hidden">
          <Settings2 size={17} />
        </button>
      </header>

      <main className="safe-main mx-auto max-w-[1400px] px-4 pt-4 sm:px-8 sm:pt-6">
        {hub && (
          <nav aria-label={`${hub.label} pages`} className="scrollbar-thin -mx-1 mb-5 flex items-center gap-1 overflow-x-auto border-b border-line px-1">
            <span className="mr-2 hidden shrink-0 items-center gap-2 py-2.5 text-[12px] uppercase tracking-[0.14em] sm:flex" style={{ color: hub.color }}>
              <Icon name={hub.icon} size={14} />{hub.label}
            </span>
            {hub.pages.map((p) => {
              const on = pageMatches(p.href, path);
              return (
                <Link key={p.href} href={p.href} data-on={on ? "1" : "0"}
                  className={`hub-tab flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2.5 text-[13.5px] transition ${on ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                  <Icon name={p.icon} size={14} className={on ? "text-accent" : ""} />{p.label}
                </Link>
              );
            })}
          </nav>
        )}
        {children}
      </main>

      {/* Mobile bottom nav: the five hubs (each hub's pages are tabs at the top of the page) */}
      <nav aria-label="Hubs" className="safe-bottom fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-2xl border border-line-2 bg-[#0a0e1a]/85 p-1.5 backdrop-blur-xl lg:hidden">
        {HUBS.map((h) => {
          const on = hub?.key === h.key;
          return (
            <Link key={h.key} href={h.pages[0].href} className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] transition ${on ? "bg-white/[0.07] text-ink" : "text-ink-3"}`}>
              <span style={on ? { color: h.color, filter: `drop-shadow(0 0 6px ${h.color})` } : undefined}><Icon name={h.icon} size={18} /></span>{h.label}
            </Link>
          );
        })}
      </nav>

      {/* Phone: settings, search and sign out */}
      {account && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Account">
          <button aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAccount(false)} />
          <div className="safe-top drawer-panel absolute right-3 top-3 w-60 space-y-1 rounded-2xl border border-line-2 bg-[#0a0e1a] p-2 shadow-2xl">
            {ACCOUNT_PAGES.map((p) => (
              <Link key={p.href} href={p.href} onClick={() => setAccount(false)} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[14px] text-ink-2 hover:bg-white/[0.05]">
                <Icon name={p.icon} size={16} />{p.label}
              </Link>
            ))}
            <button onClick={() => { setAccount(false); setOpen(true); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[14px] text-ink-2 hover:bg-white/[0.05]"><Search size={16} />Search</button>
            <form action={logout}><button className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[14px] text-ink-2 hover:bg-white/[0.05]"><LogOut size={16} />Sign out</button></form>
          </div>
        </div>
      )}

      {(open || paletteUsed) && <CommandPalette open={open} setOpen={setOpen} />}
    </div>
  );
}
