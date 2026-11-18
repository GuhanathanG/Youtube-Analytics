"use client";

import { Activity, ArrowUpRight, BrainCircuit, ChartNoAxesCombined, Check, ChevronDown, Clapperboard, Columns2, Flame, Gauge, GitCompareArrows, Globe,
  LayoutDashboard, Lightbulb, LogOut, MessageSquareText, Radar, Rocket, Search, Settings2, Sparkles, Target, TrendingUp, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { logout, setFocus } from "@/app/actions";
import dynamic from "next/dynamic";
import { LivePill } from "./LivePill";
import { ACCOUNT_PAGES, HUBS, hubOf, pageMatches } from "@/lib/nav";

// The search palette (and its library) loads the first time it's opened, not with every page.
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });

type NavChannel = { id: string; title: string; thumb: string | null; active: boolean; rival?: boolean };

const ICONS: Record<string, LucideIcon> = { Activity, BrainCircuit, ChartNoAxesCombined, Clapperboard, Columns2, Flame, Gauge, GitCompareArrows, Globe,
  LayoutDashboard, Lightbulb, MessageSquareText, Radar, Rocket, Search, Settings2, Sparkles, Target, TrendingUp, Users };
const Icon = ({ name, ...p }: { name: string; size?: number; className?: string }) => { const I = ICONS[name] ?? Activity; return <I {...p} />; };

/** The Signal wordmark: "creator·pulse" in the wide display face with a live cyan dot. */
export function Wordmark({ size = 19 }: { size?: number }) {
  return (
    <span className="font-[family-name:var(--font-display)] font-extrabold tracking-[-0.01em] text-ink" style={{ fontSize: size }}>
      creator<span className="text-accent" style={{ textShadow: "0 0 12px rgba(34,225,255,.8)" }}>·</span>pulse
    </span>
  );
}

/** YT / IG marker, so a creator's YouTube channel and Instagram account with the same name are easy to tell apart. */
const Plat = ({ id }: { id: string }) => (
  <span className={`shrink-0 rounded-sm px-1 font-mono text-[9px] tracking-[0.08em] ${id.startsWith("ig_") ? "bg-[#e1306c]/15 text-[#ff7aa8]" : "bg-[#ff3b4a]/12 text-[#ff8a92]"}`}>{id.startsWith("ig_") ? "IG" : "YT"}</span>
);

const Avatar = ({ c, size = 22 }: { c: NavChannel | undefined; size?: number }) => c?.thumb ? (
  // eslint-disable-next-line @next/next/no-img-element
  <img decoding="async" src={c.thumb} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover ring-1 ring-white/15" style={{ width: size, height: size }} />
) : <span className="grid shrink-0 place-items-center rounded-full bg-white/10 text-[10px]" style={{ width: size, height: size }}>{c?.title.slice(0, 1) ?? "∗"}</span>;

/** Close a menu on outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

/**
 * Which channel the whole site shows, plus quick links to every watched channel (this replaces the old sidebar list).
 * The list is always in the page (hidden until opened) so it is there for assistive tech and tests.
 */
function ChannelMenu({ channels, focus }: { channels: NavChannel[]; focus: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const focusable = channels.filter((c) => c.active && !c.rival); // competitors are on the Radar, not the site's focus
  const others = channels.filter((c) => !c.active || c.rival);
  const current = focusable.find((c) => c.id === focus);
  const choose = (v: string) => { setOpen(false); start(async () => { await setFocus(v); router.refresh(); }); };
  if (!channels.length) return null;
  return (
    <div ref={ref} className="relative min-w-0">
      <button onClick={() => setOpen((v) => !v)} aria-label="Channel shown across the site" aria-expanded={open} aria-haspopup="listbox" disabled={pending}
        className={`flex h-9 min-w-0 items-center gap-2 rounded-full border border-line-2 pl-1.5 pr-3 text-[13px] text-ink transition hover:border-accent/60 ${pending ? "opacity-60" : ""}`}>
        {current ? <Avatar c={current} /> : (
          <span className="flex -space-x-2">{focusable.slice(0, 3).map((c) => <Avatar key={c.id} c={c} size={20} />)}</span>
        )}
        <span className="hidden max-w-[12rem] truncate sm:inline">{current?.title ?? "All channels"}</span>
        {current && <span className="hidden sm:inline"><Plat id={current.id} /></span>}
        <ChevronDown size={14} className={`shrink-0 text-ink-3 transition ${open ? "rotate-180" : ""}`} />
      </button>
      <div hidden={!open} role="listbox" aria-label="Channels"
        className="menu-in absolute right-0 top-11 z-50 w-[min(320px,calc(100vw-24px))] border border-line-2 bg-[#0b0b10]/95 p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)] backdrop-blur-xl sm:left-0 sm:right-auto">
        <div className="label px-2 pb-2 pt-1">Show across the site</div>
        {focusable.map((c) => (
          <div key={c.id} className="group flex items-center rounded-md hover:bg-white/[0.05]">
            <button role="option" aria-selected={c.id === focus} onClick={() => choose(c.id)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left text-[13.5px]">
              <Avatar c={c} /><span className="truncate">{c.title}</span><Plat id={c.id} />
              {c.id === focus && <Check size={14} className="ml-auto shrink-0 text-accent" />}
            </button>
            <Link href={`/channels/${c.id}`} onClick={() => setOpen(false)} title="Open channel" aria-label={`Open ${c.title}`}
              className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded text-ink-3 opacity-0 transition hover:text-accent group-hover:opacity-100 focus:opacity-100"><ArrowUpRight size={14} /></Link>
          </div>
        ))}
        <button role="option" aria-selected={!focus} onClick={() => choose("all")} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13.5px] hover:bg-white/[0.05]">
          <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-line-2 text-[11px] text-ink-3">∗</span>All channels (combined)
          {!focus && <Check size={14} className="ml-auto text-accent" />}
        </button>
        {others.length > 0 && (
          <>
            <div className="label mt-2 border-t border-line px-2 pb-2 pt-3">Rivals & paused</div>
            {others.map((c) => (
              <Link key={c.id} href={`/channels/${c.id}`} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-md px-2 py-2 text-[13.5px] text-ink-2 hover:bg-white/[0.05] hover:text-ink">
                <Avatar c={c} /><span className="truncate">{c.title}</span><Plat id={c.id} />
                <span className="ml-auto font-mono text-[9.5px] tracking-[0.14em] text-ink-3">{c.rival ? "RIVAL" : "PAUSED"}</span>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function AccountMenu({ onSearch }: { onSearch: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label="Settings and account" aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full border border-line-2 text-ink-3 transition hover:border-accent/60 hover:text-ink"><Settings2 size={16} /></button>
      {open && (
        <div className="menu-in absolute right-0 top-11 z-50 w-56 border border-line-2 bg-[#0b0b10]/95 p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)] backdrop-blur-xl">
          {ACCOUNT_PAGES.map((p) => (
            <Link key={p.href} href={p.href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-ink-2 hover:bg-white/[0.05] hover:text-ink">
              <Icon name={p.icon} size={15} />{p.label}
            </Link>
          ))}
          <button onClick={() => { setOpen(false); onSearch(); }} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-ink-2 hover:bg-white/[0.05] hover:text-ink sm:hidden"><Search size={15} />Search</button>
          <form action={logout} className="mt-1 border-t border-line pt-1">
            <button className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] text-ink-2 hover:bg-white/[0.05] hover:text-ink"><LogOut size={15} />Sign out</button>
          </form>
        </div>
      )}
    </div>
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
  const hub = hubOf(path);

  return (
    <div className="min-h-dvh">
      <header className="safe-top sticky top-0 z-40 border-b border-line bg-[#07070a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-8">
          <Link href="/" aria-label="Overview" className="shrink-0"><span className="sm:hidden"><Wordmark size={16} /></span><span className="hidden sm:inline"><Wordmark /></span></Link>

          {/* Hubs: hover (or keyboard focus) opens the hub's pages. */}
          <nav aria-label="Hubs" className="ml-6 hidden items-center lg:flex">
            {HUBS.map((h) => {
              const on = hub?.key === h.key;
              return (
                <div key={h.key} className="group relative">
                  <Link href={h.pages[0].href} aria-current={on ? "page" : undefined}
                    className={`relative flex h-16 items-center px-3.5 text-[13.5px] transition ${on ? "text-ink" : "text-ink-3 hover:text-ink"}`}>
                    {h.label}
                    <span className={`absolute inset-x-3.5 bottom-0 h-[2px] transition ${on ? "bg-accent shadow-[0_0_12px_#22e1ff]" : "bg-transparent group-hover:bg-white/20"}`} />
                  </Link>
                  <div className="pointer-events-none invisible absolute left-0 top-full z-50 w-64 translate-y-1 border border-line-2 bg-[#0b0b10]/95 p-2 opacity-0 shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)] backdrop-blur-xl transition group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                    <div className="px-2.5 pb-2 pt-1.5 text-[12px] leading-snug text-ink-3">{h.question}</div>
                    {h.pages.map((p, i) => (
                      <Link key={p.href} href={p.href} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition hover:bg-white/[0.05] ${pageMatches(p.href, path) ? "text-ink" : "text-ink-2 hover:text-ink"}`}>
                        <span className="font-mono text-[10px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                        <Icon name={p.icon} size={14} className={pageMatches(p.href, path) ? "text-accent" : "text-ink-3"} />{p.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            <ChannelMenu channels={channels} focus={focus} />
            <button onClick={() => setOpen(true)} aria-label="Search"
              className="hidden h-9 items-center gap-2.5 rounded-full border border-line-2 px-3.5 text-[13px] text-ink-3 transition hover:border-accent/60 hover:text-ink sm:flex">
              <Search size={15} /><span className="hidden xl:inline">Search</span>
              <kbd className="font-mono text-[10.5px] text-ink-3">⌘K</kbd>
            </button>
            <LivePill />
            <AccountMenu onSearch={() => setOpen(true)} />
          </div>
        </div>

        {/* The current hub's pages, as tabs under the bar. */}
        {hub && (
          <div className="border-t border-line">
            <nav aria-label={`${hub.label} pages`} className="scrollbar-thin mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 sm:px-8">
              <span className="mr-3 hidden shrink-0 py-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-accent sm:inline">■ {hub.label}</span>
              {hub.pages.map((p) => {
                const on = pageMatches(p.href, path);
                return (
                  <Link key={p.href} href={p.href} data-on={on ? "1" : "0"} aria-current={on ? "page" : undefined}
                    className={`relative flex shrink-0 items-center gap-1.5 px-3 py-3 text-[13px] transition ${on ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                    <Icon name={p.icon} size={14} className={on ? "text-accent" : ""} />{p.label}
                    {on && <span className="absolute inset-x-3 bottom-0 h-px bg-accent shadow-[0_0_8px_#22e1ff]" />}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className="safe-main mx-auto max-w-[1440px] px-4 pt-6 sm:px-8 sm:pt-8">{children}</main>

      {/* Phones: the five hubs along the bottom. */}
      <nav aria-label="Hubs" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-[#07070a]/90 px-1 pt-1.5 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "calc(4px + env(safe-area-inset-bottom))" }}>
        {HUBS.map((h) => {
          const on = hub?.key === h.key;
          return (
            <Link key={h.key} href={h.pages[0].href} className={`relative flex flex-1 flex-col items-center gap-1 py-1.5 text-[10.5px] transition ${on ? "text-ink" : "text-ink-3"}`}>
              {on && <span className="absolute inset-x-5 -top-1.5 h-[2px] bg-accent shadow-[0_0_10px_#22e1ff]" />}
              <span className={on ? "text-accent" : ""}><Icon name={h.icon} size={18} /></span>{h.label}
            </Link>
          );
        })}
      </nav>

      {(open || paletteUsed) && <CommandPalette open={open} setOpen={setOpen} />}
    </div>
  );
}
