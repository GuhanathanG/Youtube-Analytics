/** Creator Pulse wordmark: a fine champagne pulse line and a serif name. */
export function Logo({ size = 28, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect x="0.5" y="0.5" width="63" height="63" rx="16" fill="#141416" stroke="rgba(255,255,255,0.08)" />
        <path d="M10 34h9l5-13 8 26 7-19 4 6h11" fill="none" stroke="#c8a97e" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`font-serif-display text-[21px] leading-none text-ink ${compact ? "hidden sm:inline" : ""}`}>
        Creator <span className="italic text-accent">Pulse</span>
      </span>
    </span>
  );
}
