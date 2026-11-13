"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/** Details on demand: a button that slides a panel in from the right (a bottom sheet on phones). */
export function Drawer({ label, title, children, className = "" }: { label: ReactNode; title: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      <button onClick={() => setOpen(true)} className={`rounded-xl border border-line-2 px-4 py-2 text-[13px] text-ink-2 transition hover:border-accent/50 hover:text-ink ${className}`}>{label}</button>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
          <button aria-label="Close" className="viz-fade absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="drawer-panel absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border border-line-2 bg-[#0a0e1a] p-5 shadow-2xl
            sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[min(760px,92vw)] sm:rounded-none sm:rounded-l-3xl sm:p-7">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink">{title}</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-ink-3 hover:text-ink"><X size={18} /></button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
