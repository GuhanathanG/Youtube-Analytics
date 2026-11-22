import Image from "next/image";
import { within } from "@/lib/cache";
import { ago, compact } from "@/lib/format";
import { trainingChannels } from "@/lib/lab";
import { AddTrainingChannel, PauseToggle } from "../LabControls";

export const metadata = { title: "Training channels" };

export default async function TrainingChannelsPage() {
  const chans = await within(trainingChannels(), 8000, []);
  const videos = chans.reduce((a, c) => a + c.videos, 0);
  return (
    <>
      <section className="pt-14 md:pt-20">
        <div className="mono" style={{ color: "var(--cyan)" }}>■ Training channels</div>
        <h1 className="display mt-5 text-[34px] md:text-[52px]">More channels, smarter models.</h1>
        <p className="lede mt-5">Add other creators in your niche. Their uploads and view counts teach the Creator Model what works. They never appear on the
          dashboard, their comments aren&apos;t downloaded, and they cost about one unit of YouTube quota per 50 videos.</p>
      </section>
      <section className="mt-10 border border-[var(--hair)] p-6 md:p-8">
        <AddTrainingChannel />
      </section>
      <section className="mt-10">
        <div className="mono flex flex-wrap justify-between gap-3" style={{ fontSize: 10.5 }}>
          <span>{chans.length} channel{chans.length === 1 ? "" : "s"} · {compact(videos)} videos</span>
          <span>New uploads and stats sync with the regular background job</span>
        </div>
        {chans.length === 0 ? (
          <p className="mt-6 text-[14px] text-ink-3">None yet. Paste a channel above, e.g. a creator your audience also watches.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--hair)] border-y border-[var(--hair)]">
            {chans.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-4 py-4">
                {c.thumb ? <Image src={c.thumb} alt="" width={40} height={40} className="h-10 w-10 rounded-full" unoptimized /> : <span className="h-10 w-10 rounded-full bg-white/5" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px]" style={{ opacity: c.active ? 1 : 0.5 }}>{c.title}{!c.active && <span className="mono ml-2" style={{ fontSize: 9.5 }}>PAUSED</span>}</div>
                  <div className="mono mt-0.5" style={{ fontSize: 10.5 }}>
                    {c.handle ?? c.id} · {compact(c.subs ?? 0)} subscribers · {compact(c.videos)}{c.videoCount ? ` of ${compact(c.videoCount)}` : ""} videos
                    {c.backfilled ? " · full history" : " · history downloading"}{c.lastSynced ? ` · synced ${ago(c.lastSynced)}` : ""}
                  </div>
                </div>
                <PauseToggle id={c.id} active={c.active} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
