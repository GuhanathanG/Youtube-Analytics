/** Signal infographics drawn on the server (SVG + CSS animation, no client JavaScript). */
import Link from "next/link";

const mult = (x: number) => `${x.toFixed(x >= 10 ? 0 : 1)}×`;

/**
 * Lift bars: each style as a bar growing left (hurts) or right (helps) from a centre line,
 * with "with vs without" typical results in mono. Used for title and thumbnail styles.
 */
export function LiftBars({ rows }: { rows: { label: string; n: number; withX: number | null; withoutX: number | null; lift: number | null }[] }) {
  const max = Math.max(0.25, ...rows.map((r) => Math.abs(Math.log2(r.lift ?? 1))));
  return (
    <>
    <ul className="space-y-4">
      {rows.map((r, i) => {
        const l = Math.log2(r.lift ?? 1), w = (Math.abs(l) / max) * 50, up = l >= 0;
        const pct = Math.round(((r.lift ?? 1) - 1) * 100);
        const col = pct >= 15 ? "#22e1ff" : pct <= -13 ? "#ff3d7f" : "#8a8a93";
        return (
          <li key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate">{r.label} <span className="mono" style={{ fontSize: 9.5 }}>{r.n} videos</span></span>
              <span className="mono shrink-0" style={{ fontSize: 10 }}>{r.withX === null ? "–" : mult(r.withX)} vs {r.withoutX === null ? "–" : mult(r.withoutX)}
                <span className="ml-3 tabular" style={{ color: col, fontSize: 12 }}>{pct >= 0 ? "+" : "−"}{Math.abs(pct)}%</span></span>
            </div>
            <div className="relative h-2 bg-white/[0.04]">
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-white/25" />
              <span className="lift-bar absolute inset-y-0" style={{ background: col, boxShadow: `0 0 10px ${col}88`, width: `${w}%`,
                left: up ? "50%" : `${50 - w}%`, transformOrigin: up ? "left" : "right", animationDelay: `${i * 70}ms` }} />
            </div>
          </li>
        );
      })}
    </ul>
    <div className="mt-3 flex justify-between font-mono text-[10px] text-ink-3">
      <span>← worse · −{Math.round((1 - 2 ** -max) * 100)}%</span><span>no difference</span><span>better · +{Math.round((2 ** max - 1) * 100)}% →</span>
    </div>
    <p className="mt-1 font-mono text-[10px] text-ink-3">Typical views with the style vs without it (× = multiple of the channel&apos;s usual)</p>
    </>
  );
}

/** Tug of war: each driver pulls views up (right, cyan) or down (left, magenta) from a centre line. */
export function TugBars({ rows }: { rows: { key: string; label: string; effect: number; kind: string }[] }) {
  const max = Math.max(0.2, ...rows.map((r) => Math.abs(r.effect)));
  return (
    <>
    <ul className="space-y-5">
      {rows.map((d, i) => {
        const up = d.effect >= 0, w = (Math.abs(d.effect) / max) * 50, col = up ? "#22e1ff" : "#ff3d7f";
        return (
          <li key={d.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[14.5px]">{d.label} <span className="mono" style={{ fontSize: 9.5 }}>{d.kind}</span></span>
              <span className="display shrink-0 text-[18px] tabular" style={{ color: col }}>{up ? "+" : "−"}{Math.round(Math.abs(d.effect) * 100)}%</span>
            </div>
            <div className="relative h-2 bg-white/[0.04]">
              <span className="absolute inset-y-[-4px] left-1/2 w-px bg-white/30" />
              <span className="lift-bar absolute inset-y-0" style={{ background: col, boxShadow: `0 0 10px ${col}88`, width: `${w}%`, left: up ? "50%" : `${50 - w}%`,
                transformOrigin: up ? "left" : "right", animationDelay: `${i * 80}ms` }} />
            </div>
          </li>
        );
      })}
    </ul>
    <div className="mt-3 flex justify-between font-mono text-[10px] text-ink-3">
      <span>← lowers views · −{Math.round(max * 100)}%</span><span>no effect</span><span>raises views · +{Math.round(max * 100)}% →</span>
    </div>
    </>
  );
}


type Row = { id: string; label: string; value: number | null; href?: string; sub?: string; tag?: string; color?: string; you?: boolean };

/**
 * Ranked bars: one labelled row per item, biggest first, on a printed scale with tick values.
 * `fromRef` makes bars grow from a reference line (e.g. 1× = usual): right of it is better, left is worse.
 */
export function RankBars({ rows, ticks, fmt, refValue, refLabel, axisLabel, fromRef = false, className = "" }: {
  rows: Row[]; ticks: number[]; fmt: (v: number) => string; refValue?: number; refLabel?: string; axisLabel: string; fromRef?: boolean; className?: string;
}) {
  const lo = Math.log(ticks[0]), hi = Math.log(ticks[ticks.length - 1]);
  const p = (v: number) => Math.max(0, Math.min(100, ((Math.log(Math.max(v, ticks[0])) - lo) / (hi - lo)) * 100));
  const ref = refValue !== undefined ? p(refValue) : 0;
  return (
    <figure className={`rank-bars w-full ${className}`}>
      <ul className="space-y-2.5">
        {rows.map((r, i) => {
          const v = r.value === null ? null : p(r.value);
          const from = fromRef ? Math.min(ref, v ?? ref) : 0, width = v === null ? 0 : fromRef ? Math.abs(v - ref) : v;
          const col = r.color ?? "#22e1ff";
          const body = (
            <div className="grid grid-cols-[minmax(0,34%)_1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <div className={`truncate text-[13.5px] ${r.you ? "text-accent" : "text-ink"}`}>{r.label}{r.you ? " (you)" : ""}</div>
                {r.sub && <div className="truncate font-mono text-[10px] text-ink-3">{r.sub}</div>}
              </div>
              <div className="relative h-3.5 bg-white/[0.04]">
                {refValue !== undefined && <span className="absolute inset-y-[-4px] w-px bg-white/45" style={{ left: `${ref}%` }} />}
                <span className="rank-bar absolute inset-y-0" style={{ left: `${from}%`, width: `${Math.max(width, v === null ? 0 : 0.6)}%`, background: col,
                  ["--o" as string]: fromRef && (v ?? 0) < ref ? "right" : "left", animationDelay: `${i * 50}ms` }} />
              </div>
              <div className="w-[74px] text-right font-mono text-[12px] tabular" style={{ color: col }}>{r.value === null ? "–" : fmt(r.value)}{r.tag ? <span className="ml-1 text-[#ff3d7f]">{r.tag}</span> : null}</div>
            </div>
          );
          return <li key={r.id} className="rank-row">{r.href ? <Link href={r.href} className="block transition hover:bg-white/[0.03]">{body}</Link> : body}</li>;
        })}
      </ul>
      <div className="mt-2 grid grid-cols-[minmax(0,34%)_1fr_auto] gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{axisLabel}</span>
        <div className="relative h-4">
          {ticks.map((t) => <span key={t} className="absolute -translate-x-1/2 font-mono text-[10px] text-ink-3" style={{ left: `${p(t)}%` }}>{fmt(t)}</span>)}
        </div>
        <span className="w-[74px]" />
      </div>
      {refLabel && <figcaption className="mt-1 font-mono text-[10px] text-ink-3">│ white line = {refLabel}</figcaption>}
    </figure>
  );
}

/**
 * Radar sweep: you in the centre, competitors as blips. Distance = how different their typical views are from
 * yours (closer = similar size), blip size = uploads in the last 30 days, a ping ring = a recent breakout (2×+).
 * A cyan sweep turns continuously (CSS), blips light up as it passes.
 */
export function RadarSweep({ me, rivals, size = 420 }: {
  me: { id: string; title: string; medianViews: number | null };
  rivals: { id: string; title: string; medianViews: number | null; uploads30: number; best: number | null }[]; size?: number;
}) {
  const c = size / 2, R = size * 0.44;
  const base = Math.max(1, me.medianViews ?? 1);
  return (
    <figure className="radar relative mx-auto w-full" style={{ maxWidth: size }}>
      <div className="radar-sweep" aria-hidden />
      <svg viewBox={`0 0 ${size} ${size}`} className="relative h-auto w-full" role="img"
        aria-label={`Competitor radar: ${rivals.length} competitors around ${me.title}; closer means similar typical views`}>
        {[0.25, 0.5, 0.75, 1].map((f) => <circle key={f} cx={c} cy={c} r={R * f} fill="none" stroke="rgba(34,225,255,.14)" />)}
        {[0, 45, 90, 135].map((d) => { const a = (d * Math.PI) / 180; return <line key={d} x1={c - Math.cos(a) * R} y1={c - Math.sin(a) * R} x2={c + Math.cos(a) * R} y2={c + Math.sin(a) * R} stroke="rgba(34,225,255,.07)" />; })}
        <text x={c + 4} y={c - R * 0.25 - 4} fontSize={9} fill="#8a8a93" fontFamily="var(--f-mono)">SIMILAR</text>
        <text x={c + 4} y={c - R - 4} fontSize={9} fill="#8a8a93" fontFamily="var(--f-mono)">100× APART</text>
        {rivals.map((v, i) => {
          const d = Math.min(2, Math.abs(Math.log10(Math.max(1, v.medianViews ?? 1) / base)));
          const r = R * (0.22 + (d / 2) * 0.74);
          const a = (i / Math.max(1, rivals.length)) * Math.PI * 2 - Math.PI / 3;
          const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
          const s = 4 + Math.min(20, v.uploads30) / 20 * 7;
          const hot = (v.best ?? 0) >= 2;
          const deg = ((a * 180) / Math.PI + 90 + 360) % 360; // when the sweep passes (sweep starts at 12 o'clock)
          return (
            <Link key={v.id} href={`/channels/${v.id}`} className="radar-blip" style={{ animationDelay: `${(deg / 360) * 4}s` }}>
              <title>{`${v.title} · typical ${v.medianViews?.toLocaleString("en") ?? "–"} views · ${v.uploads30} uploads in 30 days${hot ? ` · breakout ${v.best!.toFixed(1)}×` : ""}`}</title>
              {hot && <circle cx={x} cy={y} r={s} fill="none" stroke="#ff3d7f" className="radar-ping" />}
              <circle cx={x} cy={y} r={s} fill={hot ? "#ff3d7f" : "#22e1ff"} style={{ filter: `drop-shadow(0 0 6px ${hot ? "#ff3d7f" : "#22e1ff"})` }} />
              <text x={x} y={y + s + 12} textAnchor="middle" fontSize={10} fill="#ededea" fontFamily="var(--f-body)">{v.title.length > 18 ? v.title.slice(0, 17) + "…" : v.title}</text>
            </Link>
          );
        })}
        <circle cx={c} cy={c} r={7} fill="#fff" style={{ filter: "drop-shadow(0 0 8px #22e1ff)" }} />
        <text x={c} y={c + 22} textAnchor="middle" fontSize={10} fill="#22e1ff" fontFamily="var(--f-mono)" letterSpacing="1">YOU</text>
      </svg>
    </figure>
  );
}
