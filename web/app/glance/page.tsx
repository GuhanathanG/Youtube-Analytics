import Link from "next/link";
import { BrainCircuit, ChartNoAxesCombined, Clapperboard, LayoutDashboard, Lightbulb, MessageSquareText, Radar, Rocket, Settings2, Sparkles } from "lucide-react";
import { within } from "@/lib/cache";
import { widgetData, type WidgetChannel } from "@/lib/widget";
import { recentAlerts } from "@/lib/alerts";
import { comments } from "@/lib/queries";
import { liveNow } from "@/lib/livechat";
import { ago, compact, score } from "@/lib/format";
import { GlanceRefresh } from "@/components/glance/GlanceRefresh";
import { Empty } from "@/components/ui";
import { Wordmark } from "@/components/Shell";
import { InView, Words } from "@/components/signal/InView";
import { Decode } from "@/components/signal/Decode";
import { PulseOrb } from "@/components/signal/PulseOrb";

/**
 * Pulse Glance: a phone-sized summary of every channel, built from the same pieces as the rest of the
 * site (panels, labels, mix bars, the menu's icons). Add it to the home screen from this page for a
 * separate "Glance" app icon. Refreshes itself every minute.
 */
const DOCK = [
  { href: "/command", label: "Command", Icon: Rocket },
  { href: "/", label: "Overview", Icon: LayoutDashboard },
  { href: "/studio", label: "Studio", Icon: Clapperboard },
  { href: "/ask", label: "Ask AI", Icon: Sparkles },
  { href: "/comments", label: "Comments", Icon: MessageSquareText },
  { href: "/analytics", label: "Analytics", Icon: ChartNoAxesCombined },
  { href: "/predict", label: "Predict", Icon: BrainCircuit },
  { href: "/ideas", label: "Ideas", Icon: Lightbulb },
  { href: "/manage", label: "Manage", Icon: Settings2 },
];

export default async function GlancePage() {
  const [data, alerts, latest, live] = await Promise.all([
    within(widgetData(), 10_000, { at: new Date().toISOString(), engine: null, engineAt: null, channels: [] as WidgetChannel[] }),
    within(recentAlerts(3), 6000, []), within(comments({ hideSpam: true }, "newest", 4), 6000, []), within(liveNow(), 5000, []),
  ]);
  const ok = data.engine === "ok" || data.engine === "skipped";
  const today = data.channels.reduce((n, c) => n + c.comments24h, 0);
  const maxC = Math.max(1, ...data.channels.map((c) => c.comments));
  const sats = data.channels.map((c) => ({ id: c.id, title: c.title, thumb: c.thumb, weight: Math.sqrt(c.comments / maxC), mood: (c.sentiment ?? 0) / 100 }));
  const mood = (s: string | null) => (s === "positive" ? "var(--cyan)" : s === "negative" ? "var(--magenta)" : "var(--neutral)");
  return (
    <main className="sig sig-page mx-auto max-w-xl px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <GlanceRefresh />
      <header className="flex h-12 items-center justify-between gap-3">
        <Link href="/" aria-label="Open Creator Pulse"><Wordmark size={17} /></Link>
        <span className="mono flex items-center gap-2" style={{ fontSize: 10, color: ok ? "var(--ink-2)" : "var(--magenta)" }}>
          <i className={ok ? "live" : ""} style={ok ? undefined : { width: 7, height: 7, background: "var(--magenta)", display: "inline-block" }} />
          {ok ? "Live" : data.engine ?? "Engine"} · {data.engineAt ? ago(data.engineAt) : "—"}
        </span>
      </header>

      <InView as="section" className="mt-6">
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ <span>Glance</span></div>
        <div className="label sr-only">Glance</div>
        <h1 className="display mt-3 text-[40px]"><Words text={`${data.channels.length} channel${data.channels.length === 1 ? "" : "s"} live.`} /></h1>
        <p className="rise lede mt-3" style={{ fontSize: 15, transitionDelay: "250ms" }}>
          <Decode value={today} format="int" /> comments in the last 24 hours. The core beats faster when they arrive.
        </p>
        <div className="rise -mx-2 mt-2" style={{ transitionDelay: "150ms" }}><PulseOrb perDay={today} satellites={sats} size={360} /></div>
      </InView>

      {live.length > 0 && (
        <Link href={`/videos/${live[0].id}`} className="cell mt-2 flex items-center gap-3 border border-[var(--magenta)] px-4 py-3">
          <span className="h-2 w-2 shrink-0 animate-[pulse-dot_1.2s_ease-out_infinite] rounded-full bg-neg" />
          <span className="mono" style={{ color: "var(--magenta)", fontSize: 10 }}>Live now</span>
          <span className="truncate text-[13.5px]">{live[0].channel}: {live[0].title}</span>
        </Link>
      )}

      {/* Channel cards, swipe sideways */}
      <section className="glance-rail -mx-5 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2" aria-label="Channels">
        {data.channels.length === 0 && <div className="w-full"><Empty>No channels yet. <Link href="/manage" className="text-accent">Add one</Link>.</Empty></div>}
        {data.channels.map((c) => {
          const n = c.positive + c.neutral + c.negative;
          return (
            <div key={c.id} className="w-[86%] shrink-0 snap-center border border-[var(--hair-2)] p-5">
              <Link href={`/channels/${c.id}`} className="block">
                <div className="flex items-center gap-3">
                  {c.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img decoding="async" src={c.thumb} alt="" referrerPolicy="no-referrer" className="h-11 w-11 rounded-full object-cover ring-1 ring-white/15" />
                  ) : <div className="grid h-11 w-11 place-items-center rounded-full bg-white/10 font-semibold">{c.title.slice(0, 1)}</div>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{c.title}</div>
                    <div className="mono mt-0.5 truncate" style={{ fontSize: 9.5 }}>{c.platform === "instagram" ? "Instagram" : "YouTube"} / {compact(c.followers)} {c.platform === "instagram" ? "followers" : "subs"}</div>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5">
                  {([["Sentiment", c.sentiment === null ? "–" : score(c.sentiment / 100), (c.sentiment ?? 0) >= 0 ? "var(--cyan)" : "var(--magenta)"], ["Today", `+${compact(c.comments24h)}`, "var(--ink)"],
                    ["Comments", compact(c.comments), "var(--ink)"], ["Read by AI", `${c.aiRead}%`, "var(--magenta)"]] as [string, string, string][]).map(([k, v, col]) => (
                    <div key={k}>
                      <div className="mono" style={{ fontSize: 9.5 }}>{k}</div>
                      <div className="display mt-1.5 text-[26px] tabular" style={{ color: col }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div className="bar mt-5" style={{ display: "flex" }}>
                  {[["positive", c.positive], ["neutral", c.neutral], ["negative", c.negative]].map(([k, v]) => (
                    <span key={k as string} style={{ width: `${n ? ((v as number) / n) * 100 : 0}%`, background: mood(k as string), transform: "none" }} />
                  ))}
                </div>
              </Link>
              <div className="mt-5 flex flex-wrap gap-2">
                {[["Analytics", `/analytics?c=${encodeURIComponent(c.id)}`], ["Report", `/report/${encodeURIComponent(c.id)}`], ["Comments", `/comments?channel=${encodeURIComponent(c.id)}`]].map(([l, h]) => (
                  <Link key={l} href={h} className="pill pill-line" style={{ padding: "5px 12px", fontSize: 12 }}>{l}</Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* Every page one tap away */}
      <nav className="mt-6 grid grid-cols-3 border-l border-t border-[var(--hair)]" aria-label="Open">
        {DOCK.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="flex flex-col items-center gap-1.5 border-b border-r border-[var(--hair)] px-2 py-4 text-[12.5px] transition hover:bg-white/[0.03] hover:text-[var(--cyan)]" style={{ color: "var(--ink-2)" }}>
            <Icon size={19} />{label}
          </Link>
        ))}
      </nav>

      <section className="mt-8">
        <div className="mono" style={{ color: "var(--cyan)" }}>■ Alerts</div>
        <p className="mt-1 text-[13px]" style={{ color: "var(--ink-3)" }}>New uploads, negative spikes and viral comments</p>
        {alerts.length === 0 ? <p className="mt-4 text-[13.5px]" style={{ color: "var(--ink-3)" }}>All quiet for now.</p> : (
          <ul className="mt-3 divide-y divide-[var(--hair)] border-y border-[var(--hair)]">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link href={a.link ?? "/"} className="block py-3 transition hover:text-[var(--cyan)]">
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-[14px]">{a.title}</span>
                    <span className="mono shrink-0" style={{ fontSize: 9.5 }}>{ago(a.created_at)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[13px]" style={{ color: "var(--ink-2)" }}>{a.body}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <div className="mono" style={{ color: "var(--cyan)" }}>■ Latest comments</div>
          <Link href="/comments" className="text-[13px] hover:text-[var(--cyan)]" style={{ color: "var(--ink-3)" }}>All comments →</Link>
        </div>
        {latest.length === 0 ? <p className="mt-4 text-[13.5px]" style={{ color: "var(--ink-3)" }}>Comments appear here as they arrive.</p> : (
          <ul className="mt-4 space-y-4">
            {latest.map((c) => (
              <li key={c.id} className="border-l-2 pl-3.5" style={{ borderColor: mood(c.sentiment) }}>
                <p className="line-clamp-2 text-[14px] leading-relaxed">{c.translation || c.text}</p>
                <p className="mono mt-1" style={{ fontSize: 9.5 }}>{c.author_name ?? "Viewer"} / {c.channel_title}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mono mt-10 text-center" style={{ fontSize: 9.5 }}>Updated {ago(data.at)} · refreshes every minute</p>
    </main>
  );
}
