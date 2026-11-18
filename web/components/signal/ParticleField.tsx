"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { reducedMotion, useInView } from "./InView";

export type FieldDot = { s: "positive" | "neutral" | "negative"; v: number; lang: string; emo: string; t: number; ch: string; text: string; who: string };
type Layout = "mood" | "language" | "emotion" | "channel" | "time";
type Label = { x: number; y: number; title: string; sub: string };

const COL = { positive: [34, 225, 255], neutral: [150, 150, 162], negative: [255, 61, 127] } as const;
const LANG_NAMES: Record<string, string> = { en: "English", ta: "Tamil", "ta-latn": "Tanglish", hi: "Hindi", "hi-latn": "Hinglish", te: "Telugu", "te-latn": "Telugu (Latin)",
  ml: "Malayalam", "ml-latn": "Malayalam (Latin)", kn: "Kannada", other: "Other" };
const langName = (k: string) => LANG_NAMES[k.toLowerCase()] ?? k;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Every comment is a dot (colour = mood). Choose a lens and the dots fly into it: mood clusters, languages,
 * emotions, channels, or a time stream (left → right, positive up / negative down). Hover/tap a dot to read it.
 */
export function ParticleField({ dots, channels, height = 540 }: { dots: FieldDot[]; channels: Record<string, string>; height?: number }) {
  const [layout, setLayout] = useState<Layout>("mood");
  const [labels, setLabels] = useState<Label[]>([]);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [boxRef, inView] = useInView<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ x: Float32Array; y: Float32Array; fx: Float32Array; fy: Float32Array; tx: Float32Array; ty: Float32Array; delay: Float32Array; start: number; seed: Float32Array } | null>(null);
  const layoutRef = useRef<Layout>("mood");

  // Fewer dots on small screens keeps phones smooth (decided after mount, so server and browser render the same first).
  const [cap, setCap] = useState(6000);
  useEffect(() => { if (window.innerWidth < 640) setCap(2500); }, []);
  const data = useMemo(() => dots.slice(0, cap), [dots, cap]);

  useEffect(() => {
    const n = data.length;
    const rnd = new Float32Array(n).map((_, i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1);
    state.current = { x: new Float32Array(n), y: new Float32Array(n), fx: new Float32Array(n), fy: new Float32Array(n), tx: new Float32Array(n), ty: new Float32Array(n),
      delay: new Float32Array(n).map((_, i) => rnd[i] * 450), start: 0, seed: rnd };
  }, [data]);

  // Compute target positions for a layout in pixels.
  const place = (lay: Layout, W: number, H: number) => {
    const st = state.current;
    if (!st) return [] as Label[];
    const n = data.length;
    const lbl: Label[] = [];
    if (lay === "time") {
      let t0 = Infinity, t1 = -Infinity;
      for (const d of data) { if (d.t < t0) t0 = d.t; if (d.t > t1) t1 = d.t; }
      const span = Math.max(1, t1 - t0), padX = 28;
      for (let i = 0; i < n; i++) {
        const d = data[i];
        st.tx[i] = padX + ((d.t - t0) / span) * (W - padX * 2);
        const v = d.s === "positive" ? Math.max(0.15, d.v) : d.s === "negative" ? Math.min(-0.15, d.v) : d.v * 0.3;
        st.ty[i] = H * 0.5 - v * H * 0.36 + (st.seed[i] - 0.5) * 26;
      }
      const f = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      lbl.push({ x: padX, y: H - 14, title: f(t0), sub: "oldest" }, { x: W - padX - 60, y: H - 14, title: f(t1), sub: "newest" },
        { x: padX, y: 18, title: "positive ↑", sub: "" }, { x: padX, y: H - 46, title: "negative ↓", sub: "" });
      return lbl;
    }
    const keyOf = (d: FieldDot) => lay === "mood" ? d.s : lay === "language" ? d.lang : lay === "emotion" ? d.emo : d.ch;
    const counts = new Map<string, number[]>();
    data.forEach((d, i) => { const k = keyOf(d); (counts.get(k) ?? counts.set(k, []).get(k)!).push(i); });
    let groups = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
    if (lay === "mood") groups = (["negative", "neutral", "positive"] as const).map((k) => [k, counts.get(k) ?? []] as [string, number[]]);
    const maxG = lay === "mood" ? 3 : W < 640 ? 4 : 7;
    if (groups.length > maxG) {
      const rest = groups.slice(maxG - 1).flatMap((g) => g[1]);
      groups = [...groups.slice(0, maxG - 1), ["other", rest]];
    }
    const g = groups.length;
    const rows = W < 640 && g > 2 ? 2 : 1;
    const perRow = Math.ceil(g / rows);
    const cellW = W / perRow, cellH = (H - 40) / rows;
    const biggest = Math.max(1, ...groups.map((x) => x[1].length));
    const rMax = Math.min(cellW, cellH) * 0.42;
    groups.forEach(([key, idx], gi) => {
      const row = Math.floor(gi / perRow), col = gi % perRow;
      const inRow = Math.min(perRow, g - row * perRow);
      const cx = (W - inRow * cellW) / 2 + col * cellW + cellW / 2, cy = 14 + row * cellH + cellH / 2 - 6;
      const r = Math.max(10, rMax * Math.sqrt(idx.length / biggest));
      // Sunflower spiral: an even, crafted-looking disc; sorted by sentiment so colours band from the centre out.
      const order = [...idx].sort((a, b) => data[b].v - data[a].v);
      order.forEach((i, j) => {
        const rr = r * Math.sqrt((j + 0.5) / order.length), th = j * GOLDEN;
        st.tx[i] = cx + Math.cos(th) * rr; st.ty[i] = cy + Math.sin(th) * rr;
      });
      const name = lay === "mood" ? key : lay === "language" ? langName(key) : lay === "channel" ? (channels[key] ?? key) : key;
      lbl.push({ x: cx, y: cy + r + 20, title: name, sub: `${idx.length.toLocaleString("en")} · ${Math.round((idx.length / data.length) * 100)}%` });
    });
    return lbl;
  };

  // Render loop.
  useEffect(() => {
    const cv = canvas.current, box = boxRef.current, st = state.current;
    if (!cv || !box || !st || !inView) return;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const still = reducedMotion();
    let W = 0, H = 0, raf = 0, visible = true;
    // Glow sprites per mood.
    const sprite = (rgb: readonly number[]) => {
      const c = document.createElement("canvas"); c.width = c.height = 16 * dpr;
      const g = c.getContext("2d")!; const gr = g.createRadialGradient(8 * dpr, 8 * dpr, 0, 8 * dpr, 8 * dpr, 8 * dpr);
      gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.18, `rgba(${rgb},.9)`); gr.addColorStop(0.45, `rgba(${rgb},.18)`); gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 16 * dpr, 16 * dpr); return c;
    };
    const sp = { positive: sprite(COL.positive), neutral: sprite(COL.neutral), negative: sprite(COL.negative) };
    const resize = () => {
      W = box.clientWidth; H = height;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setLabels(place(layoutRef.current, W, H));
      for (let i = 0; i < data.length; i++) { st.fx[i] = st.x[i]; st.fy[i] = st.y[i]; }
      st.start = performance.now();
      if (!raf) raf = requestAnimationFrame(draw);
    };
    // First time: everything starts in the centre and bursts out.
    W = box.clientWidth; H = height;
    for (let i = 0; i < data.length; i++) { st.x[i] = W / 2 + (st.seed[i] - 0.5) * 4; st.y[i] = H / 2 + (st.seed[(i * 7) % data.length] - 0.5) * 4; }
    const ro = new ResizeObserver(resize); ro.observe(box);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(draw); });
    io.observe(box);
    (box as HTMLDivElement & { __relayout?: () => void }).__relayout = () => {
      setLabels(place(layoutRef.current, W, H));
      for (let i = 0; i < data.length; i++) { st.fx[i] = st.x[i]; st.fy[i] = st.y[i]; }
      st.start = performance.now();
      if (!raf) raf = requestAnimationFrame(draw);
    };

    function draw(now: number) {
      raf = 0;
      if (!visible) return;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      let moving = false;
      const dur = 1300;
      for (let i = 0; i < data.length; i++) {
        const t = still ? 1 : Math.min(1, Math.max(0, (now - st!.start - st!.delay[i]) / dur));
        if (t < 1) moving = true;
        const e = 1 - Math.pow(1 - t, 4);
        // Small idle drift so the field breathes.
        const drift = still ? 0 : Math.sin(now * 0.0009 + st!.seed[i] * 40) * 0.9;
        st!.x[i] = st!.fx[i] + (st!.tx[i] - st!.fx[i]) * e + drift;
        st!.y[i] = st!.fy[i] + (st!.ty[i] - st!.fy[i]) * e + Math.cos(now * 0.0011 + st!.seed[i] * 30) * 0.9 * (still ? 0 : 1);
        const d = data[i];
        const s = d.s === "positive" ? 7 : d.s === "negative" ? 7.5 : 5.5;
        ctx.drawImage(sp[d.s], st!.x[i] - s / 2, st!.y[i] - s / 2, s, s);
      }
      ctx.globalCompositeOperation = "source-over";
      if (!still || moving) raf = requestAnimationFrame(draw);
    }
    resize();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, data, height]);

  const choose = (l: Layout) => {
    setLayout(l); layoutRef.current = l; setPinned(null);
    (boxRef.current as (HTMLDivElement & { __relayout?: () => void }) | null)?.__relayout?.();
  };

  const nearest = (mx: number, my: number) => {
    const st = state.current; if (!st) return null;
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < data.length; i++) { const dx = st.x[i] - mx, dy = st.y[i] - my, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = i; } }
    return best >= 0 ? best : null;
  };

  const show = pinned ?? hover?.i ?? null;
  const d = show !== null ? data[show] : null;
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const x of data) counts[x.s]++;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Arrange comments by">
          {(["mood", "language", "emotion", "channel", "time"] as Layout[]).map((l) => (
            <button key={l} role="tab" aria-selected={layout === l} onClick={() => choose(l)}
              className={`pill ${layout === l ? "pill-on" : "pill-line"}`} style={{ padding: "7px 14px", fontSize: 12 }}>
              <span className="mono" style={{ color: "inherit", fontSize: 10.5 }}>{l}</span>
            </button>
          ))}
        </div>
        <div className="mono flex gap-4" style={{ fontSize: 10.5 }}>
          <span style={{ color: "#22e1ff" }}>■ {counts.positive.toLocaleString("en")} positive</span>
          <span>■ {counts.neutral.toLocaleString("en")} neutral</span>
          <span style={{ color: "#ff3d7f" }}>■ {counts.negative.toLocaleString("en")} negative</span>
        </div>
      </div>
      <div ref={boxRef} className="relative cursor-crosshair" style={{ height }}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = nearest(e.clientX - r.left, e.clientY - r.top); setHover(i === null ? null : { i, x: e.clientX - r.left, y: e.clientY - r.top }); }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPinned(nearest(e.clientX - r.left, e.clientY - r.top)); }}>
        <canvas ref={canvas} className="absolute inset-0" aria-label={`${data.length} comments arranged by ${layout}`} role="img" />
        {labels.map((l, i) => (
          <div key={`${layout}-${i}`} className={`rise in pointer-events-none absolute ${layout === "time" ? "text-left" : "-translate-x-1/2 text-center"}`}
            style={{ left: l.x, top: l.y, transitionDelay: `${600 + i * 80}ms` }}>
            <div className="text-[13px] capitalize" style={{ color: "var(--ink)" }}>{l.title}</div>
            {l.sub && <div className="mono" style={{ fontSize: 9.5 }}>{l.sub}</div>}
          </div>
        ))}
        {d && (
          <div className="absolute z-10 w-[min(320px,80vw)] border p-3" style={{
            left: Math.min((hover?.x ?? 40) + 14, (boxRef.current?.clientWidth ?? 400) - 330), top: Math.max(0, (hover?.y ?? 40) - 20),
            background: "rgba(7,7,10,.94)", borderColor: d.s === "positive" ? "#22e1ff" : d.s === "negative" ? "#ff3d7f" : "var(--hair-2)" }}>
            <div className="mono flex justify-between gap-2" style={{ fontSize: 9.5 }}>
              <span>{channels[d.ch] ?? ""}</span><span>{langName(d.lang)} · {d.emo}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--ink)" }}>{d.text}</p>
            <div className="mono mt-1.5" style={{ fontSize: 9.5 }}>{d.who} · {new Date(d.t * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}{pinned !== null ? " · pinned" : ""}</div>
          </div>
        )}
      </div>
    </div>
  );
}
