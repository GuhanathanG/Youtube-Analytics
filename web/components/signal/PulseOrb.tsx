"use client";
import { useEffect, useRef } from "react";
import { reducedMotion } from "./InView";

export type Satellite = { id: string; title: string; thumb: string | null; weight: number; mood: number };

/**
 * The Pulse Orb: a glowing core that beats with the audience (faster when more comments arrive), sends out
 * pulse rings, pulls in comment particles, and carries the watched channels on tilted orbits.
 * Canvas 2D with additive blending (no WebGL needed), DPR-aware, paused off-screen.
 */
export function PulseOrb({ perDay, satellites, size = 560 }: { perDay: number; satellites: Satellite[]; size?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sats = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    const cv = canvas.current, box = wrap.current;
    if (!cv || !box) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const still = reducedMotion();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    const resize = () => {
      W = box.clientWidth; H = box.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(box);

    // Heartbeat: 34 bpm when quiet, up to ~110 bpm when thousands of comments a day arrive.
    const bpm = Math.min(110, 34 + Math.log10(perDay + 1) * 22);
    const beatMs = 60000 / bpm;
    const rings: { born: number }[] = [];
    const motes: { a: number; r: number; v: number; size: number; hue: number }[] = [];
    const spawnEvery = Math.max(40, 900 - Math.log10(perDay + 1) * 220);
    let lastBeat = 0, lastSpawn = 0, raf = 0, visible = true;
    const orbits = [
      { rx: 0.42, ry: 0.13, tilt: -0.32, speed: 0.000055 },
      { rx: 0.34, ry: 0.2, tilt: 0.45, speed: -0.00008 },
      { rx: 0.47, ry: 0.27, tilt: 0.08, speed: 0.00004 },
    ];
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(draw); });
    io.observe(box);

    function ellipsePoint(o: (typeof orbits)[number], t: number, cx: number, cy: number, R: number) {
      const x = Math.cos(t) * o.rx * R * 2, y = Math.sin(t) * o.ry * R * 2;
      return { x: cx + x * Math.cos(o.tilt) - y * Math.sin(o.tilt), y: cy + x * Math.sin(o.tilt) + y * Math.cos(o.tilt), front: Math.sin(t) > 0 };
    }

    function draw(now: number) {
      raf = 0;
      if (!visible) return;
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2;
      ctx!.clearRect(0, 0, W, H);

      // Orbits (hairlines).
      ctx!.globalCompositeOperation = "source-over";
      for (const o of orbits) {
        ctx!.beginPath();
        ctx!.ellipse(cx, cy, o.rx * R * 2, o.ry * R * 2, o.tilt, 0, Math.PI * 2);
        ctx!.strokeStyle = "rgba(255,255,255,0.09)"; ctx!.lineWidth = 1; ctx!.stroke();
      }

      // Heartbeat.
      if (!still && now - lastBeat > beatMs) { lastBeat = now; rings.push({ born: now }); }
      const sinceBeat = (now - lastBeat) / beatMs;
      const thump = still ? 0 : Math.exp(-sinceBeat * 6) * 0.22 + Math.exp(-Math.max(0, sinceBeat - 0.18) * 7) * 0.12 * (sinceBeat > 0.18 ? 1 : 0);

      ctx!.globalCompositeOperation = "lighter";
      // Pulse rings.
      for (let i = rings.length - 1; i >= 0; i--) {
        const age = (now - rings[i].born) / 2600;
        if (age > 1) { rings.splice(i, 1); continue; }
        ctx!.beginPath(); ctx!.arc(cx, cy, R * 0.06 + age * R * 0.85, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(34,225,255,${0.35 * (1 - age) ** 2})`; ctx!.lineWidth = 1.2; ctx!.stroke();
      }

      // Incoming comment motes, spiralling into the core.
      if (!still && now - lastSpawn > spawnEvery && motes.length < 220) {
        lastSpawn = now;
        motes.push({ a: Math.random() * Math.PI * 2, r: R * (0.75 + Math.random() * 0.3), v: 0.4 + Math.random() * 0.8, size: 0.6 + Math.random() * 1.4, hue: Math.random() });
      }
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.r -= m.v * (1 + (R * 0.9 - m.r) / R); m.a += 0.004 * m.v;
        if (m.r < R * 0.07) { motes.splice(i, 1); continue; }
        const x = cx + Math.cos(m.a) * m.r, y = cy + Math.sin(m.a) * m.r * 0.92;
        const col = m.hue > 0.86 ? "255,61,127" : m.hue > 0.7 ? "180,180,190" : "34,225,255";
        ctx!.fillStyle = `rgba(${col},${0.25 + 0.6 * (1 - m.r / R)})`;
        ctx!.fillRect(x, y, m.size, m.size);
      }

      // Core glow (bloom by stacking soft gradients).
      const core = R * (0.075 + thump * 0.12);
      for (const [rad, a, col] of [[core * 9, 0.08, "34,225,255"], [core * 4.5, 0.18, "34,225,255"], [core * 2.2, 0.45, "150,240,255"], [core * 1.1, 1, "255,255,255"]] as const) {
        const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
        ctx!.fillStyle = g; ctx!.beginPath(); ctx!.arc(cx, cy, rad, 0, Math.PI * 2); ctx!.fill();
      }

      // Satellites (HTML avatars positioned on the orbits; behind the core when on the far side).
      satellites.forEach((s, i) => {
        const el = sats.current[i];
        if (!el) return;
        const o = orbits[i % orbits.length];
        const t = (still ? 0 : now * o.speed) + (i / Math.max(1, satellites.length)) * Math.PI * 2 + i;
        const p = ellipsePoint(o, t, cx, cy, R);
        const scale = p.front ? 1 : 0.72;
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${scale})`;
        el.style.opacity = p.front ? "1" : "0.45";
        el.style.zIndex = p.front ? "3" : "1";
      });

      if (!still) raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [perDay, satellites]);

  return (
    <div ref={wrap} className="relative mx-auto aspect-square w-full" style={{ maxWidth: size }}>
      <canvas ref={canvas} className="absolute inset-0" aria-hidden style={{ zIndex: 2 }} />
      {satellites.map((s, i) => {
        const d = 30 + Math.min(1, s.weight) * 22;
        const ring = s.mood >= 0.15 ? "var(--cyan)" : s.mood <= -0.05 ? "var(--magenta)" : "var(--neutral)";
        return (
          <a key={s.id} href={`/channels/${s.id}`} ref={(el) => { sats.current[i] = el; }} title={s.title}
            className="group absolute left-0 top-0 flex flex-col items-center gap-1.5 transition-opacity" style={{ willChange: "transform" }}>
            {s.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.thumb} alt="" width={d} height={d} className="rounded-full object-cover" style={{ width: d, height: d, boxShadow: `0 0 0 1px ${ring}, 0 0 18px ${ring}55` }} />
            ) : <span className="grid place-items-center rounded-full" style={{ width: d, height: d, boxShadow: `0 0 0 1px ${ring}` }}>{s.title[0]}</span>}
            <span className="mono whitespace-nowrap opacity-0 transition group-hover:opacity-100" style={{ fontSize: 9.5, color: "var(--ink)" }}>{s.title}</span>
          </a>
        );
      })}
    </div>
  );
}
