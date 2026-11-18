import Link from "next/link";
import type { ReactNode } from "react";
import { Words } from "./InView";

/**
 * Signal section header: "■ 02 / 06 · LABEL", a display title that slides in word by word, an optional
 * description in a readable column, and an optional action (tabs, links) on the right.
 */
export function SigHead({ n, of, label, title, children, action }: {
  n: number; of: number; label: string; title: string; children?: ReactNode; action?: ReactNode;
}) {
  const side = children || action;
  return (
    <div className={`sec-head grid gap-5 lg:items-end lg:gap-16 ${side ? "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : ""}`}>
      <div className="min-w-0">
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ {String(n).padStart(2, "0")} / {String(of).padStart(2, "0")} · {label}</div>
        <h2 className="display mt-4 text-[28px] md:text-[36px] xl:text-[40px]"><Words text={title} /></h2>
      </div>
      {side && (
        <div className="rise min-w-0 space-y-4 lg:pb-1.5" style={{ transitionDelay: "250ms" }}>
          {children && <p className="lede" style={{ fontSize: 15.5 }}>{children}</p>}
          {action}
        </div>
      )}
    </div>
  );
}

/** A pill-shaped link button in the Signal style. */
export function Pill({ href, children, solid = false }: { href: string; children: ReactNode; solid?: boolean }) {
  return <Link href={href} className={`pill ${solid ? "pill-solid" : "pill-line"}`}>{solid && <span className="sq" />}{children}</Link>;
}
