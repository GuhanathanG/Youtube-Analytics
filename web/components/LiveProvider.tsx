"use client";

import { Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";

type Tick = { status: string; message?: string; newComments: number; newVideos: number; labelled: number; backfilled?: number; at: string };
type Toast = { id: number; text: string; tone: "info" | "warn" };
type Ctx = { enabled: boolean; setEnabled: (v: boolean) => void; last: Tick | null; busy: boolean; checkNow: () => void; notify: (t: string, tone?: Toast["tone"]) => void };

const LiveCtx = createContext<Ctx | null>(null);
export const useLive = () => useContext(LiveCtx)!;

const INTERVAL_MS = 60_000;

/** Runs live mode while the site is open: checks YouTube every minute and refreshes the page when something new arrives. */
export function LiveProvider({ children, initial }: { children: ReactNode; initial: Tick | null }) {
  const router = useRouter();
  const [enabled, setEnabledState] = useState(true);
  const [last, setLast] = useState<Tick | null>(initial);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busyRef = useRef(false);
  // New data while you're reading further down: offer it instead of reloading under you.
  const [waiting, setWaiting] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const keep = useRef<{ y: number; touched: boolean } | null>(null);

  /** Swap in fresh data without moving the page: remember where you were and put you back if the page jumped. */
  const refreshInPlace = useCallback(() => {
    setWaiting(null);
    keep.current = { y: window.scrollY, touched: false };
    startRefresh(() => router.refresh());
  }, [router]);
  useEffect(() => {
    const k = keep.current;
    if (refreshing || !k) return;
    keep.current = null;
    requestAnimationFrame(() => { if (!k.touched && Math.abs(window.scrollY - k.y) > 40) window.scrollTo({ top: k.y }); });
  }, [refreshing]);
  useEffect(() => {
    const touch = () => { if (keep.current) keep.current.touched = true; };
    const opts = { passive: true } as const;
    window.addEventListener("wheel", touch, opts); window.addEventListener("touchmove", touch, opts); window.addEventListener("keydown", touch);
    return () => { window.removeEventListener("wheel", touch); window.removeEventListener("touchmove", touch); window.removeEventListener("keydown", touch); };
  }, []);

  useEffect(() => {
    try { if (localStorage.getItem("cp-live") === "off") setEnabledState(false); } catch { /* storage blocked */ }
  }, []);
  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    try { localStorage.setItem("cp-live", v ? "on" : "off"); } catch { /* ignore */ }
  };

  const notify = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const checkNow = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const res = await fetch("/api/live", { method: "POST" });
      if (res.status === 401) { window.location.href = "/login"; return; }
      const tick: Tick = await res.json();
      setLast(tick);
      if (tick.newComments || tick.newVideos) {
        const parts = [];
        if (tick.newComments) parts.push(`${tick.newComments} new comment${tick.newComments === 1 ? "" : "s"}`);
        if (tick.newVideos) parts.push(`${tick.newVideos} new video${tick.newVideos === 1 ? "" : "s"}`);
        const text = parts.join(" · ");
        // At the top of the page: update straight away. Further down (reading, typing): offer a button instead.
        const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
        if (window.scrollY < 160 && !typing) { notify(`✦ ${text}${tick.labelled ? ` — ${tick.labelled} read by AI` : ""}`); refreshInPlace(); }
        else setWaiting(text);
      } else if (tick.backfilled) {
        // Older history arrived quietly: it shows on the next page you open; nothing moves now.
      } else if (tick.status === "quota") {
        notify("YouTube's daily quota is used up — live mode resumes after midnight Pacific.", "warn");
      }
    } catch { /* offline: try again next minute */ }
    finally { busyRef.current = false; setBusy(false); }
  }, [notify, refreshInPlace]);

  useEffect(() => {
    if (!enabled) return;
    const run = () => { if (document.visibilityState === "visible") void checkNow(); };
    const first = setTimeout(run, 2500);
    const timer = setInterval(run, INTERVAL_MS);
    document.addEventListener("visibilitychange", run);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", run); };
  }, [enabled, checkNow]);

  return (
    <LiveCtx.Provider value={{ enabled, setEnabled, last, busy, checkNow, notify }}>
      {children}
      {waiting && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
          <button onClick={refreshInPlace}
            className="anim-toast-in pointer-events-auto flex items-center gap-2 rounded-full border border-accent/50 bg-[#07141a]/90 px-4 py-2 text-[13px] text-ink shadow-[0_0_24px_-6px_#22d3ee] backdrop-blur-xl">
            <Radio size={14} className="text-accent" />{waiting} · <span className="text-accent">Update</span>
          </button>
        </div>
      )}
      <div className="pointer-events-none fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2 lg:bottom-6" aria-live="polite">
                  {toasts.map((t) => (
            <div key={t.id}
              className={`anim-toast-in pointer-events-auto flex max-w-[360px] items-center gap-2.5 rounded-xl border px-4 py-3 text-[13.5px] shadow-2xl backdrop-blur-xl ${t.tone === "warn" ? "border-warn/40 bg-[#1a1408]/90 text-warn" : "border-accent/40 bg-[#07141a]/90 text-ink"}`}>
              <Radio size={15} className={t.tone === "warn" ? "" : "text-accent"} />{t.text}
            </div>
          ))}
      </div>
    </LiveCtx.Provider>
  );
}

function since(iso: string | undefined, now: number | null) {
  if (!iso || now === null) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

/** The pill in the top bar: shows live status and lets you pause it or check right now. */
export function LivePill() {
  const { enabled, setEnabled, last, busy, checkNow } = useLive();
  // null until running on the device, so the server's and the phone's "12s ago" never disagree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const off = last?.status === "off";
  const problem = last?.status === "error" || last?.status === "quota";
  const label = !enabled ? "Live paused" : off ? "Live off" : busy ? "Checking…" : problem ? (last?.status === "quota" ? "Quota used up" : "Live · retrying") : `Live · ${since(last?.at, now) || "starting"}`;
  const dot = !enabled || off ? "bg-ink-3" : problem ? "bg-warn" : "bg-accent animate-[pulse-dot_2s_ease-out_infinite]";
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto">
      <button onClick={() => (enabled ? checkNow() : setEnabled(true))} title={last?.message ?? "Check YouTube for new comments now"}
        className="flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-ink-2 transition hover:border-accent/40 hover:text-ink">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="hidden sm:inline">{label}</span>
        <span className="sr-only sm:hidden">{enabled && !off ? "Live" : "Off"}</span>
      </button>
      {enabled && !off && (
        <button onClick={() => setEnabled(false)} className="hidden rounded-full px-2 py-1 text-[11.5px] text-ink-3 hover:text-ink-2 sm:block" title="Pause live mode">pause</button>
      )}
    </div>
  );
}
