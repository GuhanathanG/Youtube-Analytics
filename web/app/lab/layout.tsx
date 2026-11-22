import Link from "next/link";
import { Wordmark } from "@/components/Shell";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Model Lab", template: "%s · Model Lab" } };

/** The Model Lab: its own console (own top bar and menu), behind the same sign-in as the dashboard. */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sig sig-page min-h-screen">
      <header className="border-b border-[var(--hair)]">
        <div className="wrap flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
          <Link href="/lab" className="flex items-center gap-3" aria-label="Model Lab home">
            <Wordmark size={17} />
            <span className="mono" style={{ color: "var(--cyan)" }}>/ Model Lab</span>
          </Link>
          <nav aria-label="Model Lab" className="flex gap-6 text-[14px]">
            <Link href="/lab" className="hover:text-[var(--cyan)]">Models</Link>
            <Link href="/lab/channels" className="hover:text-[var(--cyan)]">Training channels</Link>
          </nav>
          <Link href="/" className="pill pill-line ml-auto" style={{ fontSize: 12.5 }}>← Dashboard</Link>
        </div>
      </header>
      <main className="wrap pb-24">{children}</main>
    </div>
  );
}
