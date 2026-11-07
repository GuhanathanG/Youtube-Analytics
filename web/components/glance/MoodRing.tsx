/** Neon ring for the mood score (−100 … +100): the arc fills with how positive the audience is. */
export function MoodRing({ score, size = 104 }: { score: number | null; size?: number }) {
  const r = 42, c = 2 * Math.PI * r;
  const share = score === null ? 0 : (score + 100) / 200;
  const color = score === null ? "#7c869b" : score > 15 ? "#22d3ee" : score < -15 ? "#e66767" : "#fab219";
  const id = `mr-${color.slice(1)}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color} /><stop offset="1" stopColor="#8b7cf6" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${c * share} ${c}`} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-[family-name:var(--font-display)] text-[26px] font-semibold leading-none tabular" style={{ color }}>
            {score === null ? "—" : `${score > 0 ? "+" : ""}${score}`}
          </div>
          <div className="mt-1 font-mono text-[8.5px] tracking-[0.25em] text-ink-3">MOOD</div>
        </div>
      </div>
    </div>
  );
}
