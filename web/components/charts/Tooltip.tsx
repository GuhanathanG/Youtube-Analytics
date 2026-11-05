"use client";

type Item = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number };

export function GlassTooltip({ active, payload, label, labelFormat, valueFormat }:
  { active?: boolean; payload?: Item[]; label?: string | number; labelFormat?: (l: string) => string; valueFormat?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + Math.abs(Number(p.value) || 0), 0);
  return (
    <div className="rounded-xl border border-line-2 bg-[#0b1020]/90 px-3 py-2 text-[12.5px] shadow-2xl backdrop-blur-md">
      {label !== undefined && <div className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(String(label)) : label}</div>}
      {payload.filter((p) => Number(p.value) !== 0).map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-6 text-ink-2">
          <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.name}</span>
          <span className="tabular text-ink">{valueFormat ? valueFormat(Math.abs(Number(p.value))) : new Intl.NumberFormat("en").format(Math.abs(Number(p.value)))}</span>
        </div>
      ))}
      {payload.length > 1 && <div className="mt-1 border-t border-line pt-1 text-right text-ink-3 tabular">{new Intl.NumberFormat("en").format(total)} total</div>}
    </div>
  );
}
