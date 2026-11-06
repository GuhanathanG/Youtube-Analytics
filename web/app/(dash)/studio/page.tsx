import Link from "next/link";
import { notFound } from "next/navigation";
import { within } from "@/lib/cache";
import { focusChannel } from "@/lib/focus";
import { channels as getChannels } from "@/lib/queries";
import { getDraft, listDrafts, titleContext, type StudioDraft } from "@/lib/studio";
import { nextMoves } from "@/lib/recommendations";
import { StudioForm } from "@/components/studio/StudioForm";
import { TitleLab } from "@/components/studio/TitleLab";
import { TitleScoreCard } from "@/components/studio/TitleScoreCard";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { ago } from "@/lib/format";

export const metadata = { title: "Studio" };
export const maxDuration = 60;

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string }> }) {
  const sp = await searchParams;
  const chs = (await getChannels()).filter((c) => c.active);
  const focus = await focusChannel(chs.map((c) => c.id));
  const draft = sp.d && /^\d+$/.test(sp.d) ? await getDraft(Number(sp.d)) : null;
  if (sp.d && !draft) notFound();
  const ch = chs.find((c) => c.id === (draft?.channel_id ?? focus)) ?? chs[0];
  if (!ch) return (<><PageHeader eyebrow="Studio" title={<>Content <span className="glow-text">Studio</span></>} /><Empty>Add a channel on the Manage page first.</Empty></>);
  const lab = sp.tab === "lab";
  const [drafts, ctx, moves] = await Promise.all([within(listDrafts(ch.id), 6000, []), within(titleContext(ch.id), 15_000, null),
    lab ? Promise.resolve(null) : within(nextMoves(ch.id), 15_000, null)]);
  const suggestions = [...new Set([...(ctx?.ideas ?? []),
    ...(moves?.moves ?? []).filter((m) => m.id.startsWith("repeat-")).map((m) => m.title.replace(/^Follow up “(.*)”$/, "Part 2: $1"))])].slice(0, 6);
  const tab = (key: string, label: string, href: string) => (
    <Link href={href} className={`rounded-xl px-4 py-2 text-[13.5px] ${(key === "lab") === lab ? "bg-accent/15 text-ink ring-1 ring-accent/40" : "text-ink-2 hover:text-ink"}`}>{label}</Link>
  );
  return (
    <>
      <PageHeader eyebrow={`Studio · ${ch.title}`} title={<>Content <span className="glow-text">Studio</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Plan videos with the AI, grounded in {ch.title}&apos;s own breakouts, what viewers ask for and its
          long-term memory. Score titles against what has actually worked here.</p>
        <div className="mt-4 inline-flex gap-1 rounded-2xl border border-line bg-white/[0.03] p-1">
          {tab("studio", "Plan a video", "/studio")}{tab("lab", "Packaging Lab", "/studio?tab=lab")}
        </div>
      </PageHeader>

      {lab ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Reveal className="xl:col-span-2"><Panel title="Score your titles" subtitle="Against this channel's own winners: patterns, proven words, length and what viewers ask for">
            <TitleLab channelId={ch.id} />
          </Panel></Reveal>
          <Reveal delay={0.05}><Panel title="What works here">
            <ul className="space-y-2 text-[13px]">
              {(ctx?.features ?? []).filter((f) => f.lift !== null && f.with >= 3 && f.without >= 3).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)).slice(0, 6).map((f) => (
                <li key={f.label} className="flex justify-between gap-3"><span className="text-ink-2">{f.label}</span>
                  <span className={`font-mono ${(f.lift ?? 1) >= 1 ? "text-accent" : "text-neg"}`}>{f.lift!.toFixed(1)}×</span></li>
              ))}
            </ul>
            {(ctx?.demand.length ?? 0) > 0 && <>
              <div className="label mt-5">Viewers ask about</div>
              <div className="mt-2 flex flex-wrap gap-1.5">{ctx!.demand.map((d) => <span key={d} className="chip">{d}</span>)}</div>
            </>}
          </Panel></Reveal>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <Reveal><Panel title="New video plan" subtitle="Angles, scored titles, thumbnail, hook, outline and tags">
              <StudioForm channelId={ch.id} suggestions={suggestions} />
            </Panel></Reveal>
            {draft && <DraftView d={draft} />}
          </div>
          <Reveal delay={0.05}><Panel title="Your plans">
            {drafts.length === 0 ? <p className="text-[13px] text-ink-3">Plans you create are saved here.</p> : (
              <ul className="space-y-1.5">
                {drafts.map((d) => (
                  <li key={d.id}><Link href={`/studio?d=${d.id}`} className={`block rounded-lg px-3 py-2 text-[13.5px] hover:bg-white/[0.04] ${draft?.id === d.id ? "bg-accent/10 text-ink" : "text-ink-2"}`}>
                    <span className="line-clamp-1">{d.topic}</span><span className="text-[11.5px] text-ink-3">{ago(d.created_at)}</span></Link></li>
                ))}
              </ul>
            )}
          </Panel></Reveal>
        </div>
      )}
    </>
  );
}

function DraftView({ d }: { d: StudioDraft }) {
  const x = d.data;
  return (
    <>
      <Reveal><section className="panel overflow-hidden p-5 sm:p-6">
        <div className="scanline" aria-hidden />
        <div className="font-mono text-[10.5px] tracking-[0.3em] text-accent">PLAN · {ago(d.created_at).toUpperCase()}</div>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-tight">{d.topic}</h2>
        {x.why && <p className="mt-2 text-[14px] text-ink-2">{x.why}</p>}
        {x.angles?.length ? <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {x.angles.map((a) => <div key={a.name} className="rounded-xl border border-accent/25 bg-accent/[0.05] p-3"><div className="text-[13.5px] font-semibold text-ink">{a.name}</div><p className="mt-1 text-[12.5px] text-ink-2">{a.pitch}</p></div>)}
        </div> : null}
      </section></Reveal>
      {x.titles?.length ? <Reveal><Panel title="Titles, scored for this channel">
        <div className="space-y-2.5">{x.titles.map((t, k) => <TitleScoreCard key={t.title} t={t} rank={k + 1} />)}</div>
      </Panel></Reveal> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {x.thumbnail && <Reveal><Panel title="Thumbnail">
          <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-br from-accent/20 via-[#0a0e1a] to-accent-2/25">
            <span className="px-4 text-center font-[family-name:var(--font-display)] text-[26px] font-bold uppercase leading-tight tracking-tight text-white [text-shadow:0_0_18px_rgba(34,211,238,0.8)]">{x.thumbnail.text}</span>
          </div>
          <dl className="mt-3 space-y-1 text-[13px]">
            <div><dt className="label inline">Frame </dt><dd className="inline text-ink-2">{x.thumbnail.concept}</dd></div>
            {x.thumbnail.emotion && <div><dt className="label inline">Emotion </dt><dd className="inline text-ink-2">{x.thumbnail.emotion}</dd></div>}
            {x.thumbnail.colors?.length ? <div><dt className="label inline">Colours </dt><dd className="inline text-ink-2">{x.thumbnail.colors.join(", ")}</dd></div> : null}
          </dl>
        </Panel></Reveal>}
        {x.hook && <Reveal delay={0.05}><Panel title="Hook · first 15 seconds">
          <blockquote className="border-l-2 border-accent/60 pl-4 text-[15px] italic leading-relaxed text-ink">“{x.hook}”</blockquote>
          {x.cta && <p className="mt-4 text-[13px] text-ink-2"><span className="label">End screen </span>{x.cta}</p>}
        </Panel></Reveal>}
      </div>
      {x.outline?.length ? <Reveal><Panel title="Outline">
        <ol className="relative space-y-3 border-l border-accent/25 pl-5">
          {x.outline.map((o, k) => (
            <li key={k}><span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_8px_#22d3ee]" />
              <div className="text-[14px] font-medium text-ink">{o.part}</div><p className="text-[13px] text-ink-2">{o.notes}</p></li>
          ))}
        </ol>
      </Panel></Reveal> : null}
      {x.tags?.length ? <Reveal><Panel title="Tags"><div className="flex flex-wrap gap-1.5">{x.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div></Panel></Reveal> : null}
    </>
  );
}
