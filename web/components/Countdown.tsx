"use client";
import { useEffect, useState } from "react";

/** Live "time left" that counts down every 30 seconds from a finish time (ms since epoch). */
export function Countdown({ at, className = "" }: { at: number | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  if (at === null) return <span className={className}>waiting to start</span>;
  const ms = at - now;
  if (ms <= 0) return <span className={className}>finishing…</span>;
  const m = Math.round(ms / 60000);
  const text = m < 60 ? `${Math.max(1, m)} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} days`;
  const when = new Date(at).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", ...(ms > 6 * 86400_000 ? { day: "numeric", month: "short" } : {}) });
  return <span className={className} title={`Expected around ${when}`}>{text} <span className="text-ink-3">· {when}</span></span>;
}
