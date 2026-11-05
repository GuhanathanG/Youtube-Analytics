"use client";

import { Download, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type Opt = { value: string; label: string };

function Select({ name, value, options, onChange, label }: { name: string; value: string; options: Opt[]; onChange: (n: string, v: string) => void; label: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(name, e.target.value)}
        className="h-10 rounded-xl border border-line bg-[#0a0e1a] px-3 text-[13.5px] text-ink outline-none transition hover:border-line-2 focus:border-accent/60">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function ExplorerFilters({ channels, languages, emotions, count }:
  { channels: Opt[]; languages: Opt[]; emotions: Opt[]; count: number }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const set = (name: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(name, value); else next.delete(name);
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set("q", q); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const v = (k: string, d = "") => sp.get(k) ?? d;
  const active = ["channel", "sentiment", "lang", "emotion", "type", "q"].some((k) => sp.get(k));

  return (
    <div className="panel p-4 sm:p-5">
      <div className="relative">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-accent" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every comment… e.g. audio, thumbnail, part 2, semma"
          className="h-12 w-full rounded-xl border border-line-2 bg-white/[0.03] pl-10 pr-10 text-[15px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent/60" />
        {pending && <span className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Select label="Channel" name="channel" value={v("channel")} onChange={set} options={[{ value: "", label: "All channels" }, ...channels]} />
        <Select label="Sentiment" name="sentiment" value={v("sentiment")} onChange={set}
          options={[{ value: "", label: "Any" }, { value: "positive", label: "Positive" }, { value: "neutral", label: "Neutral" }, { value: "negative", label: "Negative" }]} />
        <Select label="Language" name="lang" value={v("lang")} onChange={set} options={[{ value: "", label: "Any language" }, ...languages]} />
        <Select label="Emotion" name="emotion" value={v("emotion")} onChange={set} options={[{ value: "", label: "Any" }, ...emotions]} />
        <Select label="Type" name="type" value={v("type")} onChange={set}
          options={[{ value: "", label: "All comments" }, { value: "question", label: "❓ Questions" }, { value: "suggestion", label: "💡 Requests" }, { value: "spam", label: "🚫 Spam" }, { value: "toxic", label: "☠️ Toxic" }]} />
        <Select label="Sort" name="sort" value={v("sort", "newest")} onChange={set}
          options={[{ value: "newest", label: "Newest" }, { value: "most_liked", label: "Most liked" }, { value: "most_negative", label: "Most negative" }, { value: "most_positive", label: "Most positive" }, { value: "oldest", label: "Oldest" }]} />
        <Select label="Show" name="limit" value={v("limit", "100")} onChange={set}
          options={["100", "500", "2000"].map((n) => ({ value: n, label: `${n} comments` }))} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-ink-3">
        <span className="tabular"><span className="text-ink">{count.toLocaleString("en")}</span> shown</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v("spam") !== "show"} onChange={(e) => set("spam", e.target.checked ? "" : "show")} className="accent-cyan-400" />
          Hide spam
        </label>
        {active && (
          <button onClick={() => { setQ(""); start(() => router.replace(path, { scroll: false })); }} className="flex items-center gap-1 hover:text-ink">
            <X size={14} />Clear filters
          </button>
        )}
        <a href={`/api/export?${sp.toString()}`} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-ink-2 transition hover:border-accent/50 hover:text-ink">
          <Download size={14} />Download CSV
        </a>
      </div>
    </div>
  );
}
