/** Neon ring for the mood score (−100 … +100): the arc fills with how positive the audience is. */
export function MoodRing({ score, size = 104 }: { score: number | null; size?: number }) {
  const r = 42, c = 2 * Math.PI * r;
  const share = score === null ? 0 : (score + 100) / 200;
  const color = score === null ? "#7c869b" : score > 15 ? "#c8a97e" : score < -15 ? "#c98479" : "#d3a657";
  const id = `mr-${color.slice(1)}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color} /><stop offset="1" stopColor="#9c8467" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${c * share} ${c}`}  />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[28px] font-light leading-none tabular" style={{ color }}>
            {score === null ? "—" : `${score > 0 ? "+" : ""}${score}`}
          </div>
          <div className="mt-1.5 text-[9px] font-medium uppercase tracking-[0.2em] text-ink-3">Mood</div>
        </div>
      </div>
    </div>
  );
}
