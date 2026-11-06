import Link from "next/link";
import { isInstagram, personUrl } from "@/lib/platform";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { CommentCard } from "@/components/CommentCard";
import { MiniStat } from "@/components/AnalyticsParts";
import { Empty, PageHeader, Panel, Tag } from "@/components/ui";
import { ago, compact, score } from "@/lib/format";
import { personComments, personStats } from "@/lib/people";
import { EMOTIONS, languageName } from "@/lib/queries-shared";

export const metadata = { title: "Commenter" };

/** Everything one viewer wrote on the watched channels (?c=channel to stay within one channel). */
export default async function PersonPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ c?: string; sort?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^UC[\w-]{2,40}$/.test(id)) notFound();
  const channelId = sp.c && /^(UC[\w-]{22}|ig_[a-z0-9._]{1,30})$/.test(sp.c) ? sp.c : null;
  const order = sp.sort === "most_liked" ? "most_liked" : "newest";
  const page = Math.max(1, Math.min(200, Number(sp.page ?? 1) || 1));
  const [stats, list] = await Promise.all([personStats(id, channelId), personComments(id, channelId, order, page)]);
  if (!stats) notFound();
  const qs = (o: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const merged = { c: channelId, sort: order, page, ...o };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "" && !(k === "page" && v === 1) && !(k === "sort" && v === "newest")) p.set(k, String(v));
    const s = p.toString();
    return `/people/${id}${s ? `?${s}` : ""}`;
  };
  const pages = Math.ceil(stats.comments / 50);

  return (
    <>
      {channelId && <Link href={`/channels/${channelId}`} className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-accent"><ChevronLeft size={15} />Back to channel</Link>}
      <PageHeader eyebrow="Commenter" title={<>{stats.name ?? "Viewer"}</>}>
        <div className="flex flex-wrap items-center gap-3 text-[13.5px] text-ink-2">
          {personUrl(id, stats.name) && <a href={personUrl(id, stats.name)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">{isInstagram(id) ? "Instagram profile" : "YouTube profile"}<ExternalLink size={13} /></a>}
          <span className="text-ink-3">First seen {ago(stats.first_at)} · last {ago(stats.last_at)}</span>
          {channelId ? <Link href={qs({ c: null, page: 1 })} className="text-accent hover:underline">Show all channels</Link> : null}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Comments" value={compact(stats.comments)} hint={`on ${stats.videos} videos`} />
        <MiniStat label="Likes received" value={compact(stats.likes)} />
        <MiniStat label="Average mood" value={score(stats.avg_sentiment)} hint="−100 … +100" />
        <MiniStat label="Questions / requests" value={`${stats.questions} / ${stats.requests}`} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Panel title="Channels">
          <ul className="space-y-1.5 text-[13.5px]">{stats.channels.map((c) => (
            <li key={c.id} className="flex justify-between gap-2"><Link href={`/people/${id}?c=${c.id}`} className="truncate text-ink hover:text-accent">{c.title}</Link>
              <span className="tabular text-ink-3">{c.comments} · {score(c.avg_sentiment)}</span></li>))}</ul>
        </Panel>
        <Panel title="Languages"><div className="flex flex-wrap gap-1.5">{stats.languages.map((l) => <Tag key={l.language}>{languageName(l.language)} · {l.n}</Tag>)}</div></Panel>
        <Panel title="Usual emotions">
          {stats.emotions.length ? <div className="flex flex-wrap gap-1.5">{stats.emotions.map((e) => <Tag key={e.emotion}>{EMOTIONS[e.emotion] ?? ""} {e.emotion} · {e.n}</Tag>)}</div> : <p className="text-[13px] text-ink-3">Not read by the AI yet.</p>}
        </Panel>
      </div>

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">All comments <span className="text-ink-3">({compact(stats.comments)})</span></h2>
        <div className="flex gap-1.5 text-[13px]">
          {(["newest", "most_liked"] as const).map((o) => (
            <Link key={o} href={qs({ sort: o, page: 1 })} className={`rounded-lg border px-3 py-1.5 ${order === o ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-ink-3 hover:text-ink-2"}`}>
              {o === "newest" ? "Newest" : "Most liked"}</Link>
          ))}
        </div>
      </div>
      {list.length ? <div className="space-y-3">{list.map((c) => <CommentCard key={c.id} c={c} />)}</div> : <Empty>No comments on this page.</Empty>}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-5 flex items-center justify-center gap-3 text-[13.5px]">
          {page > 1 && <Link href={qs({ page: page - 1 })} className="rounded-lg border border-line px-3 py-1.5 text-ink-2 hover:text-ink">← Newer</Link>}
          <span className="text-ink-3">Page {page} of {pages}</span>
          {page < pages && <Link href={qs({ page: page + 1 })} className="rounded-lg border border-line px-3 py-1.5 text-ink-2 hover:text-ink">Older →</Link>}
        </nav>
      )}
    </>
  );
}
