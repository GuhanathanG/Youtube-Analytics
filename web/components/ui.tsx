import type { ReactNode } from "react";
import { Decode } from "./signal/Decode";

export function Panel({ children, className = "", title, subtitle, action }:
  { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`panel min-w-0 p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-48">
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
    <div className="relative min-w-0 overflow-hidden border border-line bg-white/[0.015] p-5 md:p-6" style={{ containerType: "inline-size" }}>
      <div className="label">{label}</div>
      <div className={`mt-4 whitespace-nowrap font-[family-name:var(--font-display)] font-extrabold ${accent ? "text-accent" : "text-ink"}`} style={{ fontSize: "min(34px, 13cqw)" }}>
        <Decode value={value} format={format === "full" ? "int" : format} />{suffix}
      </div>
      {hint && <div className="mt-1.5 text-[13px] text-ink-3">{hint}</div>}
    </div>
  );
}

const SENT_STYLES: Record<string, string> = {
  positive: "bg-pos/10 text-pos ring-pos/30",
  negative: "bg-neg/10 text-neg ring-neg/30",
  neutral: "bg-white/5 text-ink-2 ring-white/10",
};

export function SentimentChip({ value, ai }: { value: string | null; ai?: boolean }) {
  const v = value ?? "pending";
  const dot = v === "positive" ? "bg-pos" : v === "negative" ? "bg-neg" : "bg-neu";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] ring-1 ${SENT_STYLES[v] ?? "bg-white/5 text-ink-3 ring-white/10"}`}>
      <span className={`h-1.5 w-1.5 ${dot}`} />
      {v}
      {ai && <span title="Read by the AI" className="text-accent">✦</span>}
    </span>
  );
}

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "warn" }) {
  const cls = tone === "accent" ? "bg-accent/10 text-accent ring-accent/25"
    : tone === "warn" ? "bg-warn/10 text-warn ring-warn/25" : "bg-white/5 text-ink-2 ring-white/10";
  return <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11.5px] ring-1 ${cls}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-line-2 px-4 py-8 text-center text-[13.5px] text-ink-3">{children}</div>;
}

/** Signal page header: "■ EYEBROW" in mono, a large wide-face title, and the page's description. */
export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head mb-10 flex flex-col gap-5 pt-2 sm:mb-14">
      {eyebrow && <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">■ {eyebrow}</div>}
      <h1 className="font-[family-name:var(--font-display)] text-[34px] font-extrabold leading-[1.06] tracking-[-0.005em] text-ink sm:text-[48px]">{title}</h1>
      {children && <div className="page-lede max-w-[62ch] text-[15.5px] leading-[1.7] text-ink-2 [&_p]:max-w-none [&_p]:text-[15.5px] [&_p]:leading-[1.7]">{children}</div>}
    </div>
  );
}
