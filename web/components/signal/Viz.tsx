/** Signal infographics drawn on the server (SVG + CSS animation, no client JavaScript). */
import Link from "next/link";

const mult = (x: number) => `${x.toFixed(x >= 10 ? 0 : 1)}×`;

/**
 * Starburst: every upload is a ray from the centre, in upload order around the circle.
 * Length = views as a multiple of the channel's usual (log scale); breakouts (2×+) glow magenta,
 * normal results are cyan, below-usual rays stay short and grey. Rays draw out one after another.
 */
export function Starburst({ videos, size = 460 }: { videos: { id: string; title: string; outlier: number | null; views: number }[]; size?: number }) {
  const items = videos.filter((v) => v.outlier !== null && Number.isFinite(v.outlier) && v.outlier! > 0).slice(0, 360);
  const c = size / 2, inner = size * 0.08, outer = size * 0.47;
  // log2 scale: ¼× … 16× mapped onto the ray length.
  const len = (x: number) => inner + ((Math.max(-2, Math.min(4, Math.log2(x))) + 2) / 6) * (outer - inner);
  const breakouts = items.filter((v) => v.outlier! >= 2).length;
  return (
    <figure className="starburst relative mx-auto w-full" style={{ maxWidth: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img"
        aria-label={`${items.length} uploads as rays: longer means more views than usual; ${breakouts} breakouts at 2× or more`}>
        {[0.25, 1, 2, 4].map((m) => (
          <g key={m}>
            <circle cx={c} cy={c} r={len(m)} fill="none" stroke={m === 1 ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.07)"} strokeDasharray={m === 1 ? "none" : "2 4"} />
            <text x={c + 4} y={c - len(m) - 3} fontSize={9} fill="#8a8a93" fontFamily="var(--f-mono)">{mult(m)}</text>
          </g>
        ))}
        {items.map((v, i) => {
          const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;
          const r = len(v.outlier!);
          const col = v.outlier! >= 2 ? "#ff3d7f" : v.outlier! >= 1 ? "#22e1ff" : "#55555e";
          return (
            <Link key={v.id} href={`/videos/${v.id}`} className="sb-ray">
              <title>{`${v.title} · ${mult(v.outlier!)} usual · ${v.views.toLocaleString("en")} views`}</title>
              <line x1={c + Math.cos(a) * inner} y1={c + Math.sin(a) * inner} x2={c + Math.cos(a) * r} y2={c + Math.sin(a) * r}
                stroke={col} strokeWidth={v.outlier! >= 2 ? 1.6 : 1} strokeLinecap="round"
                style={{ animationDelay: `${Math.round((i / items.length) * 900)}ms`, filter: v.outlier! >= 2 ? "drop-shadow(0 0 4px #ff3d7f)" : undefined }} />
              {v.outlier! >= 2 && <circle cx={c + Math.cos(a) * r} cy={c + Math.sin(a) * r} r={2.4} fill="#fff" style={{ animationDelay: `${900 + i * 3}ms` }} className="sb-tip" />}
            </Link>
          );
        })}
        <circle cx={c} cy={c} r={inner - 6} fill="#07070a" stroke="rgba(255,255,255,.12)" />
        <text x={c} y={c - 2} textAnchor="middle" fontSize={22} fontWeight={800} fill="#ededea" fontFamily="var(--f-display)">{items.length}</text>
        <text x={c} y={c + 13} textAnchor="middle" fontSize={8} fill="#8a8a93" fontFamily="var(--f-mono)" letterSpacing="1.5">UPLOADS</text>
      </svg>
      <figcaption className="mono mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1" style={{ fontSize: 10 }}>
        <span style={{ color: "#ff3d7f" }}>■ breakout 2×+ ({breakouts})</span><span style={{ color: "#22e1ff" }}>■ at or above usual</span><span>■ below usual</span>
      </figcaption>
    </figure>
  );
}

/**
 * Lift bars: each style as a bar growing left (hurts) or right (helps) from a centre line,
 * with "with vs without" typical results in mono. Used for title and thumbnail styles.
 */
export function LiftBars({ rows }: { rows: { label: string; n: number; withX: number | null; withoutX: number | null; lift: number | null }[] }) {
  const max = Math.max(0.25, ...rows.map((r) => Math.abs(Math.log2(r.lift ?? 1))));
  return (
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
  );
}

/** Words sized by how their videos performed (bigger = better), cyan above usual, magenta below. */
export function TypeCloud({ words }: { words: { word: string; count: number; outlier: number }[] }) {
  const max = Math.max(...words.map((w) => Math.abs(Math.log2(w.outlier))), 0.3);
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-3">
      {words.map((w, i) => {
        const t = Math.log2(w.outlier) / max; // -1..1
        const size = 15 + Math.max(0, t) * 22;
        const col = w.outlier >= 1.2 ? "#22e1ff" : w.outlier <= 0.8 ? "#ff3d7f" : "#b4b4bb";
        return (
          <span key={w.word} className="cloud-word" title={`${w.count} videos · typical ${mult(w.outlier)}`} style={{ animationDelay: `${i * 50}ms` }}>
            <span className="display" style={{ fontSize: size, color: col, textShadow: w.outlier >= 1.5 ? `0 0 18px ${col}66` : undefined }}>{w.word}</span>
            <span className="mono ml-1.5 align-top" style={{ fontSize: 9.5 }}>{mult(w.outlier)}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Bullseye: each new upload's 30-day forecast lands as a dot. The centre is a breakout (4× normal or more);
 * each ring outward is half as good. Colour = cyan at or above normal, magenta for big multiples, grey below.
 */
export function Bullseye({ items, size = 340 }: { items: { id: string; title: string; vs: number; views: number }[]; size?: number }) {
  const c = size / 2, R = size * 0.46;
  const rad = (x: number) => R * (1 - (Math.max(-2, Math.min(2, Math.log2(x))) + 2) / 4.4);
  const col = (x: number) => (x >= 3 ? "#ff3d7f" : x >= 1 ? "#22e1ff" : "#8a8a93");
  return (
    <figure className="starburst mx-auto w-full" style={{ maxWidth: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-label={`${items.length} new uploads placed by expected views versus normal; centre is 4× or more`}>
        {[4, 2, 1, 0.5, 0.25].map((m) => (
          <g key={m}>
            <circle cx={c} cy={c} r={rad(m)} fill={m === 4 ? "rgba(255,61,127,.06)" : "none"} stroke={m === 1 ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.08)"} />
            <text x={c + rad(m) + 3} y={c - 3} fontSize={9} fill="#8a8a93" fontFamily="var(--f-mono)">{m >= 1 ? `${m}×` : m === 0.5 ? "½×" : "¼×"}</text>
          </g>
        ))}
        <line x1={c - R} y1={c} x2={c + R} y2={c} stroke="rgba(255,255,255,.05)" /><line x1={c} y1={c - R} x2={c} y2={c + R} stroke="rgba(255,255,255,.05)" />
        {items.map((it, i) => {
          const a = (i / Math.max(1, items.length)) * Math.PI * 2 + 0.4;
          const r = rad(it.vs), x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
          return (
            <Link key={it.id} href={`/videos/${it.id}`} className="sb-ray">
              <title>{`${it.title} · ${mult(it.vs)} normal · ${it.views.toLocaleString("en")} views expected`}</title>
              <line x1={c} y1={c} x2={x} y2={y} stroke={col(it.vs)} strokeOpacity={0.25} style={{ animationDelay: `${i * 80}ms` }} />
              <circle cx={x} cy={y} r={5} fill={col(it.vs)} className="sb-tip" style={{ animationDelay: `${500 + i * 80}ms`, filter: `drop-shadow(0 0 6px ${col(it.vs)})` }} />
            </Link>
          );
        })}
      </svg>
    </figure>
  );
}

/** Tug of war: each driver pulls views up (right, cyan) or down (left, magenta) from a centre line. */
export function TugBars({ rows }: { rows: { key: string; label: string; effect: number; kind: string }[] }) {
  const max = Math.max(0.2, ...rows.map((r) => Math.abs(r.effect)));
  return (
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
  );
}
