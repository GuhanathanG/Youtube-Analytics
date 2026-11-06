/** Ranked horizontal bars with direct labels (languages, emotions…). Max 8 rows; the rest folds into "Other". */
export function BarList({ rows, color = "#c8a97e", empty }: { rows: { label: string; value: number; hint?: string }[]; color?: string; empty?: string }) {
  if (!rows.length) return <p className="text-[13px] text-ink-3">{empty ?? "Nothing yet."}</p>;
  let list = rows;
  if (rows.length > 8) {
    const rest = rows.slice(7).reduce((s, r) => s + r.value, 0);
    list = [...rows.slice(0, 7), { label: "Other", value: rest }];
  }
  const max = Math.max(...list.map((r) => r.value));
  const total = list.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="space-y-2.5">
      {list.map((r) => (
        <li key={r.label} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-ink-2">{r.label}{r.hint && <span className="ml-2 text-ink-3">{r.hint}</span>}</span>
            <span className="tabular text-ink">{r.value.toLocaleString("en")}<span className="ml-1.5 text-ink-3">{Math.round((r.value / total) * 100)}%</span></span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5">
            <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${(r.value / max) * 100}%`, background: color, boxShadow: `0 0 12px ${color}55` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
