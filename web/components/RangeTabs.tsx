import Link from "next/link";

export const RANGES = [
  { key: "7", label: "7D", days: 7 },
  { key: "30", label: "30D", days: 30 },
  { key: "90", label: "90D", days: 90 },
  { key: "365", label: "1Y", days: 365 },
  { key: "all", label: "All", days: null },
] as const;

export function rangeSince(key: string | undefined): { key: string; since: Date | null } {
  const r = RANGES.find((x) => x.key === key) ?? RANGES[4];
  return { key: r.key, since: r.days ? new Date(Date.now() - r.days * 86400000) : null };
}

export function RangeTabs({ current, basePath, params = {} }: { current: string; basePath: string; params?: Record<string, string> }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-white/[0.03] p-1" role="tablist" aria-label="Time range">
      {RANGES.map((r) => {
        const q = new URLSearchParams({ ...params, range: r.key }).toString();
        const on = r.key === current;
        return (
          <Link key={r.key} href={`${basePath}?${q}`} scroll={false} role="tab" aria-selected={on}
            className={`rounded-full px-3 py-1.5 text-[12px] transition ${on ? "bg-white/[0.09] text-ink" : "text-ink-3 hover:text-ink-2"}`}>
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}
