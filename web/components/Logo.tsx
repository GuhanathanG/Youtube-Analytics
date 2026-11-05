export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <defs>
          <linearGradient id={`lg-${size}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor="#8b7cf6" /></linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
        <path d="M8 34h10l5-14 8 28 7-20 4 6h14" fill="none" stroke={`url(#lg-${size})`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-[family-name:var(--font-display)] text-[17px] font-semibold tracking-tight text-ink">
        Creator<span className="glow-text">Pulse</span>
      </span>
    </span>
  );
}
