import { Suspense } from "react";
import { CommentCard } from "@/components/CommentCard";
import { ExplorerFilters } from "@/components/ExplorerFilters";
import { Empty, PageHeader } from "@/components/ui";
import { parseExplorer, type ExplorerParams } from "@/lib/explorer";
import { focusChannel } from "@/lib/focus";
import { EMOTIONS, channels as getChannels, comments, languageCounts } from "@/lib/queries";

export const metadata = { title: "Comments" };

export default async function CommentsPage({ searchParams }: { searchParams: Promise<ExplorerParams> }) {
  const raw = await searchParams;
  const chs = await getChannels();
  // No channel chosen in the filters: use the channel picked in the top bar (channels never mix by default).
  const focus = raw.channel === undefined ? await focusChannel(chs.filter((c) => c.active).map((c) => c.id)) : null;
  const p = focus ? { ...raw, channel: focus } : raw;
  const { filters, order, limit } = parseExplorer(p);
  const [langs, rows] = await Promise.all([languageCounts({ channelId: filters.channelId }), comments(filters, order, limit)]);
  return (
    <>
      <PageHeader eyebrow="Explorer" title={<>Every <span className="glow-text">comment</span>, searchable</>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Filter by channel, mood, language or intent. Translations appear under non-English comments once the AI has read them.</p>
      </PageHeader>
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
