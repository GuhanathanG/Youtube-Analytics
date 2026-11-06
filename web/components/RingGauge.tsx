/** Neon ring gauge for a 0–100 score (health, progress). */
export function RingGauge({ value, label, size = 132 }: { value: number | null; label: string; size?: number }) {
  const r = 42, c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const color = value === null ? "#7c869b" : v >= 65 ? "#22d3ee" : v >= 45 ? "#fab219" : "#e66767";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value === null ? "not enough data" : Math.round(v)}`}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <defs><linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={color} /><stop offset="1" stopColor="#8b7cf6" /></linearGradient></defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle cx="50" cy="50" r={r + 6} fill="none" stroke="rgba(34,211,238,0.12)" strokeWidth="0.6" strokeDasharray="1 3" />
        <circle cx="50" cy="50" r={r} fill="none" stroke="url(#ring-grad)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(c * v) / 100} ${c}`} style={{ filter: `drop-shadow(0 0 7px ${color})` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-[family-name:var(--font-display)] text-[32px] font-semibold leading-none tabular" style={{ color }}>{value === null ? "—" : Math.round(v)}</div>
          <div className="mt-1 font-mono text-[9px] tracking-[0.25em] text-ink-3">{label}</div>
        </div>
      </div>
    </div>
  );
}
