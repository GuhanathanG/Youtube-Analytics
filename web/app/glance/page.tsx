import Link from "next/link";
import { BrainCircuit, ChartNoAxesCombined, Clapperboard, LayoutDashboard, Lightbulb, MessageSquareText, Radar, Rocket, Settings2, Sparkles } from "lucide-react";
import { within } from "@/lib/cache";
import { widgetData, type WidgetChannel } from "@/lib/widget";
import { recentAlerts } from "@/lib/alerts";
import { comments } from "@/lib/queries";
import { liveNow } from "@/lib/livechat";
import { ago, compact, score } from "@/lib/format";
import { GlanceRefresh } from "@/components/glance/GlanceRefresh";
import { MixBar } from "@/components/charts/MixBar";
import { Empty, Panel, Tag } from "@/components/ui";
import { Logo } from "@/components/Logo";

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
  return (
    <main className="mx-auto max-w-xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-ink">
      <GlanceRefresh />
      <header className="flex items-center justify-between gap-3 py-2">
        <Link href="/" aria-label="Open Creator Pulse"><Logo size={26} /></Link>
        <Tag tone={ok ? "accent" : "warn"}>
          <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-accent" : "bg-warn"}`} />
          {ok ? "Live" : data.engine ?? "Engine"} · {data.engineAt ? ago(data.engineAt) : "—"}
        </Tag>
      </header>

      <div className="mt-5">
        <div className="label">Glance</div>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          {data.channels.length} channel{data.channels.length === 1 ? "" : "s"} <span className="glow-text">live</span>
        </h1>
      </div>

      {live.length > 0 && (
        <Link href={`/videos/${live[0].id}`} className="panel panel-hover mt-4 flex items-center gap-2 px-4 py-3">
          <span className="h-2 w-2 shrink-0 animate-[pulse-dot_1.2s_ease-out_infinite] rounded-full bg-neg" />
          <Tag tone="warn">Live now</Tag>
          <span className="truncate text-[13px]">{live[0].channel}: {live[0].title}</span>
        </Link>
      )}

      {/* Channel cards (same as Overview), swipe sideways */}
      <section className="glance-rail -mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2" aria-label="Channels">
        {data.channels.length === 0 && <div className="w-full"><Empty>No channels yet. <Link href="/manage" className="text-accent">Add one</Link>.</Empty></div>}
        {data.channels.map((c) => (
          <div key={c.id} className="panel w-[86%] shrink-0 snap-center p-5">
            <Link href={`/channels/${c.id}`} className="block">
              <div className="flex items-center gap-3">
                {c.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumb} alt="" referrerPolicy="no-referrer" className="h-11 w-11 rounded-full object-cover ring-2 ring-white/10" />
                ) : <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-accent/30 to-accent-2/30 font-semibold">{c.title.slice(0, 1)}</div>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{c.title}</div>
                  <div className="truncate text-[12.5px] text-ink-3">{compact(c.followers)} {c.platform === "instagram" ? "followers" : "subs"} · {c.platform === "instagram" ? "Instagram" : "YouTube"}</div>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
                {([["Sentiment", c.sentiment === null ? "–" : score(c.sentiment / 100)], ["Today", `+${compact(c.comments24h)}`],
                  ["Comments", compact(c.comments)], ["Read by AI", `${c.aiRead}%`]] as [string, string][]).map(([k, v]) => (
                  <div key={k}>
                    <div className="label">{k}</div>
                    <div className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4"><MixBar mix={{ positive: c.positive, neutral: c.neutral, negative: c.negative }} size="sm" /></div>
            </Link>
            <div className="mt-4 flex flex-wrap gap-2">
              {[["Analytics", `/analytics?c=${encodeURIComponent(c.id)}`], ["Report", `/report/${encodeURIComponent(c.id)}`], ["Comments", `/comments?channel=${encodeURIComponent(c.id)}`]].map(([l, h]) => (
                <Link key={l} href={h} className="rounded-lg border border-line px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-accent/50 hover:text-ink">{l}</Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Every page one tap away (same tiles as the phone menu) */}
      <nav className="mt-5 grid grid-cols-3 gap-2" aria-label="Open">
        {DOCK.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="flex flex-col items-center gap-1 rounded-xl border border-line bg-white/[0.02] px-2 py-3 text-[12.5px] text-ink-2 hover:border-accent/40 hover:text-ink">
            <Icon size={19} />{label}
          </Link>
        ))}
      </nav>

      <div className="mt-5 space-y-4">
        <Panel title="Alerts" subtitle="New uploads, negative spikes and viral comments">
          {alerts.length === 0 ? <p className="text-[13px] text-ink-3">All quiet for now.</p> : (
            <ul className="space-y-2.5">
              {alerts.map((a) => (
                <li key={a.id}>
                  <Link href={a.link ?? "/"} className="block rounded-xl border border-line bg-white/[0.02] p-3 hover:border-accent/40">
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-[13px] text-ink">{a.title}</span>
                      <span className="shrink-0 text-[11.5px] text-ink-3">{ago(a.created_at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-2">{a.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Latest comments" action={<Link href="/comments" className="text-[13px] text-ink-3 hover:text-accent">All comments →</Link>}>
          {latest.length === 0 ? <p className="text-[13px] text-ink-3">Comments appear here as they arrive.</p> : (
            <ul className="space-y-3">
              {latest.map((c) => (
                <li key={c.id} className="border-l-2 pl-3" style={{ borderColor: c.sentiment === "positive" ? "var(--color-pos)" : c.sentiment === "negative" ? "var(--color-neg)" : "var(--color-neu)" }}>
                  <p className="line-clamp-2 text-[13.5px] text-ink">{c.translation || c.text}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-3">{c.author_name ?? "Viewer"} · {c.channel_title}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-center text-[12px] text-ink-3">Updated {ago(data.at)} · refreshes every minute</p>
    </main>
  );
}
