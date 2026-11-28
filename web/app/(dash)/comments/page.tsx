import { Suspense } from "react";
import { isInstagram } from "@/lib/platform";
import { CommentCard } from "@/components/CommentCard";
import { ExplorerFilters } from "@/components/ExplorerFilters";
import { Empty } from "@/components/ui";
import { parseExplorer, type ExplorerParams } from "@/lib/explorer";
import { focusChannel } from "@/lib/focus";
import { EMOTIONS, channels as getChannels, comments, dailySentiment, languageCounts, type DailyRow } from "@/lib/queries";
import { within } from "@/lib/cache";
import { particleSample } from "@/lib/concept";
import { MoodRiver } from "@/components/viz";
import { InView, Words } from "@/components/signal/InView";
import { Decode } from "@/components/signal/Decode";
import { ParticleField } from "@/components/signal/ParticleField";
import { SigHead } from "@/components/signal/Head";

export const metadata = { title: "Comments" };

const OF = 4;

export default async function CommentsPage({ searchParams }: { searchParams: Promise<ExplorerParams> }) {
  const raw = await searchParams;
  const chs = await getChannels();
  // No channel chosen in the filters: use the channel picked in the top bar (channels never mix by default).
  const focus = raw.channel === undefined ? await focusChannel(chs.filter((c) => c.active).map((c) => c.id)) : null;
  const p = focus ? { ...raw, channel: focus } : raw;
  const { filters, order, limit } = parseExplorer(p);
  const since = new Date(Date.now() - 90 * 86400_000);
  const [langs, rows, river, dots] = await Promise.all([languageCounts({ channelId: filters.channelId }), comments(filters, order, limit),
    within(dailySentiment({ channelId: filters.channelId, since }), 6000, [] as DailyRow[]),
    within(particleSample(2500, filters.channelId ?? null), 8000, [])]);
  const mood = river.reduce((a, r) => ({ positive: a.positive + r.positive, neutral: a.neutral + r.neutral, negative: a.negative + r.negative }),
    { positive: 0, neutral: 0, negative: 0 });
  const total = mood.positive + mood.neutral + mood.negative;
  const channelName = chs.find((c) => c.id === filters.channelId)?.title;
  const chNames = Object.fromEntries(chs.map((c) => [c.id, c.title]));
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <div className="sig">
      {/* 01 · Explorer */}
      <InView as="section" className="sec">
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ 01 / {String(OF).padStart(2, "0")} · Explorer · {channelName ?? "All channels"}</div>
        <h1 className="display mt-5 text-[38px] md:text-[56px]"><Words text="Every comment, searchable." /></h1>
        <p className="rise lede mt-6" style={{ transitionDelay: "300ms" }}>
          Filter by channel, mood, language or intent. Translations appear under non-English comments once the AI has read them.
        </p>
        <div className="mt-12 grid grid-cols-3 border-l border-t border-[var(--hair)]">
          {([["Positive", mood.positive, "var(--cyan)"], ["Neutral", mood.neutral, "var(--ink)"], ["Negative", mood.negative, "var(--magenta)"]] as const).map(([l, n, col], i) => (
            <div key={l} className="border-b border-r border-[var(--hair)] p-5 md:p-7" style={{ containerType: "inline-size" }}>
              <div className="mono flex justify-between gap-2" style={{ fontSize: 10 }}><span>{l}</span><span>{pct(n)}%</span></div>
              <div className="display mt-4 whitespace-nowrap" style={{ color: col, fontSize: "min(40px, 13cqw)" }}><Decode value={n} format="int" delay={i * 120} /></div>
              <div className="mono mt-2" style={{ fontSize: 9.5 }}>Last 90 days</div>
            </div>
          ))}
        </div>
      </InView>

      {/* 02 · One dot each */}
      <InView as="section" className="sec">
        <SigHead n={2} of={OF} label="Every comment" title={`${dots.length.toLocaleString("en")} comments. One dot each.`}>
          The newest comments{channelName ? ` on ${channelName}` : ""}, coloured by mood. Pick a lens and they fly into place. Hover or tap a dot to read it.
        </SigHead>
        <div className="cell p-4 md:p-8">
          {dots.length ? <ParticleField dots={dots} channels={chNames} height={500} /> : <Empty>No analysed comments yet.</Empty>}
        </div>
      </InView>

      {/* 03 · Mood river */}
      <InView as="section" className="sec">
        <SigHead n={3} of={OF} label="Mood river · 90 days" title="How they feel, day by day.">
          Comments per day, stacked by mood: the height is how many arrived, the colours how they feel. Hover a day for the counts and shares; drag the slider to zoom into any stretch.
        </SigHead>
        <div className="cell p-5 md:p-8"><MoodRiver rows={river} days={90} /></div>
      </InView>

      {/* 04 · Search */}
      <InView as="section" className="sec">
        <SigHead n={4} of={OF} label="Search" title="Find any comment." />
        <Suspense>
          <ExplorerFilters
            channels={chs.map((c) => ({ value: c.id, label: `${c.title} · ${isInstagram(c.id) ? "Instagram" : "YouTube"}` }))}
            languages={langs.filter((l) => l.code).map((l) => ({ value: l.code, label: `${l.name} (${l.comments.toLocaleString("en")})` }))}
            emotions={Object.entries(EMOTIONS).map(([k, icon]) => ({ value: k, label: `${icon} ${k}` }))}
            count={rows.length} defaultChannel={focus ?? undefined}
          />
        </Suspense>
        <div className="mt-6 grid gap-2.5 lg:grid-cols-2">
          {rows.length === 0 ? <div className="lg:col-span-2"><Empty>No comments match these filters.</Empty></div>
            : rows.map((c) => <CommentCard key={c.id} c={c} />)}
        </div>
      </InView>
    </div>
  );
}
