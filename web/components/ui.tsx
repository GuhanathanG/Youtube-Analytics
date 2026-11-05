import type { ReactNode } from "react";
import { CountUp } from "./CountUp";

export function Panel({ children, className = "", title, subtitle, action }:
  { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`panel p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, format = "compact", hint, accent = false, suffix = "" }:
  { label: string; value: number; format?: "compact" | "full" | "signed"; hint?: ReactNode; accent?: boolean; suffix?: string }) {
  return (
    <div className="panel relative overflow-hidden p-5">
      <div className="label">{label}</div>
      <div className={`mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight ${accent ? "glow-text" : "text-ink"}`}>
        <CountUp value={value} format={format} suffix={suffix} />
      </div>
      {hint && <div className="mt-1 text-[12.5px] text-ink-3">{hint}</div>}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
    </div>
  );
}

const SENT_STYLES: Record<string, string> = {
  positive: "bg-pos/15 text-[#9cc5f5] ring-pos/30",
  negative: "bg-neg/15 text-[#f3a9a9] ring-neg/30",
  neutral: "bg-white/5 text-ink-2 ring-white/10",
};

export function SentimentChip({ value, ai }: { value: string | null; ai?: boolean }) {
  const v = value ?? "pending";
  const dot = v === "positive" ? "bg-pos" : v === "negative" ? "bg-neg" : "bg-neu";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ${SENT_STYLES[v] ?? "bg-white/5 text-ink-3 ring-white/10"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {v}
      {ai && <span title="Read by the AI" className="text-accent">✦</span>}
    </span>
  );
}

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "warn" }) {
  const cls = tone === "accent" ? "bg-accent/10 text-accent ring-accent/25"
    : tone === "warn" ? "bg-warn/10 text-warn ring-warn/25" : "bg-white/5 text-ink-2 ring-white/10";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] ring-1 ${cls}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-2 px-4 py-8 text-center text-[13px] text-ink-3">{children}</div>;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:mb-8">
      {eyebrow && <div className="label">{eyebrow}</div>}
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {children}
    </div>
  );
}
