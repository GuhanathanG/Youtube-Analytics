import Image from "next/image";
import { within } from "@/lib/cache";
import { ago, compact } from "@/lib/format";
import { trainingChannels, type TrainingChannel } from "@/lib/lab";
import { TRAINING_CATEGORIES } from "@/lib/trainingdb";
import { AddTrainingChannel, PauseToggle } from "../LabControls";

export const metadata = { title: "Training channels" };

const STATUS: Record<string, [string, string]> = {
  added: ["learning", "var(--cyan)"], pending: ["queued", "var(--ink)"], doubtful: ["check the match", "var(--magenta)"],
  failed: ["not found", "var(--magenta)"], kept: ["learning", "var(--cyan)"],
};

function Row({ c }: { c: TrainingChannel }) {
  const [label, color] = STATUS[c.status] ?? [c.status, "var(--ink-3)"];
  return (
    <li className="flex flex-wrap items-center gap-4 py-4">
      {c.thumb ? <Image src={c.thumb} alt="" width={40} height={40} className="h-10 w-10 rounded-full" unoptimized /> : <span className="h-10 w-10 rounded-full bg-white/5" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px]" style={{ opacity: c.id && !c.active ? 0.5 : 1 }}>
          {c.title ?? c.query}
          <span className="mono ml-2" style={{ fontSize: 9.5, color }}>{c.id && !c.active && c.status === "added" ? "PAUSED" : label.toUpperCase()}</span>
        </div>
        <div className="mono mt-0.5" style={{ fontSize: 10.5 }}>
          {c.handle ?? c.query}{c.subs ? ` · ${compact(c.subs)} subscribers` : ""}
          {c.status === "added" ? ` · ${compact(c.videos)} videos${c.backfilled ? "" : " (downloading)"}${c.lastSynced ? ` · synced ${ago(c.lastSynced)}` : ""}` : ""}
          {c.note && c.status !== "added" ? ` · ${c.note}` : ""}
        </div>
      </div>
      {c.id && c.status === "added" && <PauseToggle id={c.id} active={c.active} />}
    </li>
  );
}

export default async function TrainingChannelsPage() {
  const data = await within(trainingChannels(), 8000, { configured: false, channels: [], videos: 0 });
  const groups = new Map<string, TrainingChannel[]>();
  for (const c of data.channels) groups.set(c.category, [...(groups.get(c.category) ?? []), c]);
  const learning = data.channels.filter((c) => c.status === "added").length;
  return (
    <>
      <section className="pt-14 md:pt-20">
        <div className="mono" style={{ color: "var(--cyan)" }}>■ Training channels</div>
        <h1 className="display mt-5 text-[34px] md:text-[52px]">More channels, smarter models.</h1>
        <p className="lede mt-5">Leading Tamil creators in each niche teach the Creator Model what works. They live in a separate training database, so the
          dashboard&apos;s database stays untouched: only their newest 500 uploads and view counts are kept, no comments.</p>
      </section>
      <section className="mt-10 border border-[var(--hair)] p-6 md:p-8">
        <AddTrainingChannel categories={TRAINING_CATEGORIES} />
      </section>
      <section className="mt-10">
        <div className="mono flex flex-wrap justify-between gap-3" style={{ fontSize: 10.5 }}>
          <span>{learning} learning · {groups.size} niches · {compact(data.videos)} videos</span>
          <span>Refreshed every 6 hours by the training job</span>
        </div>
        {!data.configured ? <p className="mt-6 text-[14px] text-ink-3">No training database is set up yet.</p>
          : data.channels.length === 0 ? <p className="mt-6 text-[14px] text-ink-3">Nothing yet: the first training run adds the researched channels.</p>
          : [...groups.entries()].map(([cat, chans]) => (
            <div key={cat} className="mt-8">
              <h2 className="mono" style={{ color: "var(--ink)" }}>{cat}</h2>
              <ul className="mt-2 divide-y divide-[var(--hair)] border-y border-[var(--hair)]">{chans.map((c) => <Row key={c.query} c={c} />)}</ul>
            </div>
          ))}
      </section>
    </>
  );
}
