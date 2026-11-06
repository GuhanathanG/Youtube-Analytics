import { BarList } from "@/components/charts/BarList";
import { Panel } from "@/components/ui";
import { compact } from "@/lib/format";
import { TRAFFIC_LABELS, type OwnerReport } from "@/lib/owner";

const mins = (s: number | null) => (s === null ? "–" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

/** Private YouTube Analytics for a connected channel (last 28 days). */
export function OwnerPanel({ r }: { r: OwnerReport & { updated_at: string } }) {
  const ctrDays = r.daily.filter((d) => d.ctr !== null && d.ctr !== undefined);
  const impressions = r.daily.reduce((s, d) => s + (d.impressions ?? 0), 0);
  const ctr = ctrDays.length && impressions ? ctrDays.reduce((s, d) => s + (d.ctr ?? 0) * (d.impressions ?? 0), 0) / impressions : null;
  const tiles: [string, string][] = [
    ["Views · 28 d", compact(r.totals.views)], ["Watch time", `${compact(Math.round(r.totals.minutes / 60))} h`],
    ["Avg view", mins(r.totals.avgViewDuration)], ["Avg % watched", r.totals.avgViewPct === null ? "–" : `${r.totals.avgViewPct.toFixed(0)}%`],
    ["Subscribers", `+${compact(r.totals.subsGained)} / −${compact(r.totals.subsLost)}`],
    ...(r.reach ? [["Impressions", compact(impressions)], ["Click-through", ctr === null ? "–" : `${ctr.toFixed(1)}%`]] as [string, string][] : []),
  ];
  return (
    <Panel title="Private analytics · connected" subtitle={`From YouTube Analytics, ${r.range.start} → ${r.range.end}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-accent/20 bg-accent/[0.04] px-3 py-2.5">
            <div className="label">{k}</div><div className="mt-1 font-[family-name:var(--font-display)] text-[18px] font-semibold tabular">{v}</div>
          </div>
        ))}
      </div>
      {r.traffic.length > 0 && (
        <div className="mt-5">
          <div className="label mb-2">Where views come from</div>
          <BarList rows={r.traffic.slice(0, 7).map((t) => ({ label: TRAFFIC_LABELS[t.source] ?? t.source, value: t.views }))} empty="" />
        </div>
      )}
    </Panel>
  );
}
