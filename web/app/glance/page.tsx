import Link from "next/link";
import { within } from "@/lib/cache";
import { widgetData, type WidgetChannel } from "@/lib/widget";
import { recentAlerts } from "@/lib/alerts";
import { comments } from "@/lib/queries";
import { liveNow } from "@/lib/livechat";
import { compact } from "@/lib/format";
import { GlanceRefresh } from "@/components/glance/GlanceRefresh";
import { MoodRing } from "@/components/glance/MoodRing";

/**
 * Pulse Glance: a full-screen, widget-style view of every channel, made for the phone. Add it to the
 * home screen from this page for a separate "Glance" app icon. Refreshes itself every minute.
 */
const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime()) / 60000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

const DOCK = [
  { href: "/", label: "Overview", glyph: "◎" },
  { href: "/ask", label: "Ask AI", glyph: "✦" },
  { href: "/comments", label: "Comments", glyph: "≋" },
  { href: "/analytics", label: "Analytics", glyph: "◢" },
  { href: "/ideas", label: "Ideas", glyph: "✧" },
  { href: "/compare", label: "Compare", glyph: "⇄" },
  { href: "/manage", label: "Manage", glyph: "⚙" },
  { href: "/comments?type=question", label: "Questions", glyph: "?" },
];

export default async function GlancePage() {
  const [data, alerts, latest, live] = await Promise.all([
    within(widgetData(), 10_000, { at: new Date().toISOString(), engine: null, engineAt: null, channels: [] as WidgetChannel[] }),
    within(recentAlerts(3), 6000, []), within(comments({ hideSpam: true }, "newest", 4), 6000, []), within(liveNow(), 5000, []),
  ]);
  const ok = data.engine === "ok" || data.engine === "skipped";
  return (
    <main className="glance min-h-dvh px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-ink">
      <GlanceRefresh />
      <header className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.35em] text-accent/80">PULSE // GLANCE</div>
          <div className="mt-1 font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-tight">
            {data.channels.length} channel{data.channels.length === 1 ? "" : "s"} <span className="glow-text">live</span>
          </div>
        </div>
        <div className={`glance-chip ${ok ? "" : "glance-chip-warn"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-accent animate-[pulse-dot_2s_ease-out_infinite]" : "bg-warn"}`} />
          <span className="font-mono text-[10.5px] tracking-wider">{ok ? "ENGINE" : (data.engine ?? "ENGINE").toUpperCase()} · {ago(data.engineAt)}</span>
        </div>
      </header>

      {live.length > 0 && (
        <Link href={`/videos/${live[0].id}`} className="glance-live mt-4 flex items-center gap-2 rounded-2xl px-4 py-3">
          <span className="h-2 w-2 animate-[pulse-dot_1.2s_ease-out_infinite] rounded-full bg-neg" />
          <span className="font-mono text-[11px] tracking-widest text-neg">LIVE</span>
          <span className="truncate text-[13px]">{live[0].channel}: {live[0].title}</span>
        </Link>
      )}

      {/* Channel cards: swipe sideways */}
      <section className="glance-rail -mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2" aria-label="Channels">
        {data.channels.length === 0 && <div className="glance-card w-full p-6 text-ink-2">No channels yet. <Link href="/manage" className="text-accent">Add one</Link>.</div>}
        {data.channels.map((c) => (
          <div key={c.id} className="glance-card relative w-[86%] shrink-0 snap-center overflow-hidden p-5">
            <div className="glance-grid" aria-hidden />
            <Link href={`/channels/${c.id}`} className="relative block">
            <div className="relative flex items-center gap-3">
              {c.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumb} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-xl object-cover ring-1 ring-accent/40" />
              ) : <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 font-semibold text-accent">{c.title.slice(0, 1)}</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{c.title}</div>
                <div className="font-mono text-[10px] tracking-widest text-ink-3">{c.platform === "instagram" ? "INSTAGRAM" : "YOUTUBE"} · {compact(c.followers)} {c.platform === "instagram" ? "FOLLOWERS" : "SUBS"}</div>
              </div>
            </div>
            <div className="relative mt-4 flex items-center gap-4">
              <MoodRing score={c.sentiment} />
              <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-3">
                <Stat label="TODAY" value={`+${compact(c.comments24h)}`} />
                <Stat label="TOTAL" value={compact(c.comments)} />
                <Stat label="AI READ" value={`${c.aiRead}%`} />
                <Stat label="POSITIVE" value={`${c.positive}%`} />
              </dl>
            </div>
            <div className="relative mt-4 flex h-1.5 overflow-hidden rounded-full bg-white/5" aria-label={`${c.positive}% positive, ${c.neutral}% neutral, ${c.negative}% negative`}>
              <span style={{ width: `${c.negative}%` }} className="bg-neg shadow-[0_0_10px_#e66767]" />
              <span style={{ width: `${c.neutral}%` }} className="bg-neu" />
              <span style={{ width: `${c.positive}%` }} className="bg-accent shadow-[0_0_10px_#22d3ee]" />
            </div>
            </Link>
            <div className="relative mt-4 flex gap-2 text-[11.5px]">
              {[["Analytics", `/analytics?c=${encodeURIComponent(c.id)}`], ["Report", `/report/${encodeURIComponent(c.id)}`], ["Comments", `/comments?channel=${encodeURIComponent(c.id)}`]].map(([l, h]) => (
                <Link key={l} href={h} className="glance-pill">{l}</Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Quick actions: every part of the site, one tap away */}
      <nav className="mt-5 grid grid-cols-4 gap-2.5" aria-label="Open">
        {DOCK.map((d) => (
          <Link key={d.href} href={d.href} className="glance-key flex flex-col items-center justify-center gap-1 py-3">
            <span className="text-[19px] leading-none text-accent">{d.glyph}</span>
            <span className="text-[10.5px] text-ink-2">{d.label}</span>
          </Link>
        ))}
      </nav>

      <section className="glance-card mt-5 p-4" aria-label="Signals">
        <div className="mb-2 font-mono text-[10px] tracking-[0.3em] text-ink-3">SIGNALS</div>
        {alerts.length === 0 ? <p className="text-[13px] text-ink-3">All quiet. Alerts for uploads, spikes and viral comments appear here.</p> : (
          <ul className="space-y-2.5">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link href={a.link ?? "/"} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-2 shadow-[0_0_8px_#8b7cf6]" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-[13px]">{a.title}</span>
                    <span className="line-clamp-1 text-[11.5px] text-ink-3">{a.body}</span>
                  </span>
                  <span className="font-mono text-[10px] text-ink-3">{ago(a.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glance-card mt-3 p-4" aria-label="Latest comments">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.3em] text-ink-3">LATEST VOICES</span>
          <Link href="/comments" className="font-mono text-[10px] tracking-widest text-accent">ALL →</Link>
        </div>
        <ul className="space-y-2.5">
          {latest.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${c.sentiment === "positive" ? "bg-accent" : c.sentiment === "negative" ? "bg-neg" : "bg-neu"}`} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13px] text-ink">{c.translation || c.text}</span>
                <span className="text-[11px] text-ink-3">{c.author_name ?? "Viewer"} · {c.channel_title}</span>
              </span>
            </li>
          ))}
          {latest.length === 0 && <li className="text-[13px] text-ink-3">Comments appear here as they arrive.</li>}
        </ul>
      </section>

      <p className="mt-6 text-center font-mono text-[10px] tracking-widest text-ink-3">UPDATED {ago(data.at).toUpperCase()} · AUTO-REFRESH 60S</p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9.5px] tracking-[0.2em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-[family-name:var(--font-display)] text-[19px] font-semibold tabular">{value}</dd>
    </div>
  );
}
