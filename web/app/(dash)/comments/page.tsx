import { Suspense } from "react";
import { CommentCard } from "@/components/CommentCard";
import { ExplorerFilters } from "@/components/ExplorerFilters";
import { Empty, PageHeader } from "@/components/ui";
import { parseExplorer, type ExplorerParams } from "@/lib/explorer";
import { focusChannel } from "@/lib/focus";
import { EMOTIONS, channels as getChannels, comments, dailySentiment, languageCounts, type DailyRow } from "@/lib/queries";
import { within } from "@/lib/cache";
import { HeroStage, MoodGlyph, MoodRiver } from "@/components/viz";

export const metadata = { title: "Comments" };

export default async function CommentsPage({ searchParams }: { searchParams: Promise<ExplorerParams> }) {
  const raw = await searchParams;
  const chs = await getChannels();
  // No channel chosen in the filters: use the channel picked in the top bar (channels never mix by default).
  const focus = raw.channel === undefined ? await focusChannel(chs.filter((c) => c.active).map((c) => c.id)) : null;
  const p = focus ? { ...raw, channel: focus } : raw;
  const { filters, order, limit } = parseExplorer(p);
  const since = new Date(Date.now() - 90 * 86400_000);
  const [langs, rows, river] = await Promise.all([languageCounts({ channelId: filters.channelId }), comments(filters, order, limit),
    within(dailySentiment({ channelId: filters.channelId, since }), 6000, [] as DailyRow[])]);
  const mood = river.reduce((a, r) => ({ positive: a.positive + r.positive, neutral: a.neutral + r.neutral, negative: a.negative + r.negative }),
    { positive: 0, neutral: 0, negative: 0 });
  const channelName = chs.find((c) => c.id === filters.channelId)?.title;
  return (
    <>
      <PageHeader eyebrow="Explorer" title={<>Every <span className="glow-text">comment</span>, searchable</>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Filter by channel, mood, language or intent. Translations appear under non-English comments once the AI has read them.</p>
      </PageHeader>
      <HeroStage className="mb-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex shrink-0 items-center gap-4 lg:w-56 lg:flex-col lg:items-start">
            <MoodGlyph {...mood} size={104} />
            <div>
              <div className="label">Mood river · 90 days</div>
              <p className="mt-1 text-[13px] text-ink-2">{channelName ?? "All channels"}: how many comments arrive each day, and how they feel. Wider = busier.</p>
            </div>
          </div>
          <div className="min-w-0 flex-1"><MoodRiver rows={river} days={90} /></div>
        </div>
      </HeroStage>
      <Suspense>
        <ExplorerFilters
          channels={chs.map((c) => ({ value: c.id, label: c.title }))}
          languages={langs.filter((l) => l.code).map((l) => ({ value: l.code, label: `${l.name} (${l.comments.toLocaleString("en")})` }))}
          emotions={Object.entries(EMOTIONS).map(([k, icon]) => ({ value: k, label: `${icon} ${k}` }))}
          count={rows.length} defaultChannel={focus ?? undefined}
        />
      </Suspense>
      <div className="mt-5 grid gap-2.5 lg:grid-cols-2">
        {rows.length === 0 ? <div className="lg:col-span-2"><Empty>No comments match these filters.</Empty></div>
          : rows.map((c) => <CommentCard key={c.id} c={c} />)}
      </div>
    </>
  );
}
