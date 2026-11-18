import Link from "next/link";
import { isInstagram, personUrl } from "@/lib/platform";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { CommentCard } from "@/components/CommentCard";
import { Empty } from "@/components/ui";
import { InView, Words } from "@/components/signal/InView";
import { Decode } from "@/components/signal/Decode";
import { SigHead } from "@/components/signal/Head";
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

  const maxCh = Math.max(1, ...stats.channels.map((c) => c.comments));
  const moodCol = (v: number | null) => ((v ?? 0) > 0.15 ? "var(--cyan)" : (v ?? 0) < -0.05 ? "var(--magenta)" : "var(--ink)");
  const tag = "inline-flex items-center gap-1.5 border border-[var(--hair-2)] px-2.5 py-1 text-[13px]";
  return (
    <div className="sig">
      <InView as="section" className="sec">
        {channelId && <Link href={`/channels/${channelId}`} className="mono mb-6 inline-flex items-center gap-1 hover:text-[var(--cyan)]"><ChevronLeft size={14} />Back to channel</Link>}
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ Commenter dossier</div>
        <h1 className="display mt-5 break-words text-[38px] md:text-[56px]"><Words text={stats.name ?? "Viewer"} /></h1>
        <div className="rise mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px]" style={{ color: "var(--ink-2)", transitionDelay: "250ms" }}>
          {personUrl(id, stats.name) && <a href={personUrl(id, stats.name)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-[var(--cyan)]">{isInstagram(id) ? "Instagram profile" : "YouTube profile"}<ExternalLink size={13} /></a>}
          <span className="mono" style={{ fontSize: 10.5 }}>First seen {ago(stats.first_at)} / last {ago(stats.last_at)}</span>
          {channelId ? <Link href={qs({ c: null, page: 1 })} className="hover:underline" style={{ color: "var(--cyan)" }}>Show all channels</Link> : null}
        </div>
        <div className="mt-12 grid grid-cols-2 border-l border-t border-[var(--hair)] lg:grid-cols-4">
          {([["0001", "Comments", stats.comments, "int", `on ${stats.videos} videos`, "var(--ink)"], ["0010", "Likes received", stats.likes, "compact", "", "var(--ink)"],
            ["0011", "Average mood", Math.round((stats.avg_sentiment ?? 0) * 100), "signed", "−100 … +100", moodCol(stats.avg_sentiment)],
            ["0100", "Questions / requests", stats.questions, "int", `${stats.requests} requests`, "var(--cyan)"]] as const).map(([i, l, v, f, hint, col], k) => (
            <div key={l} className="border-b border-r border-[var(--hair)] p-5 md:p-7" style={{ containerType: "inline-size" }}>
              <div className="mono flex justify-between gap-2" style={{ fontSize: 10 }}><span style={{ color: "var(--cyan)" }}>{i}</span><span className="truncate">{l}</span></div>
              <div className="display mt-5 whitespace-nowrap" style={{ color: col, fontSize: "min(38px, 13cqw)" }}><Decode value={v} format={f} delay={k * 110} /></div>
              {hint && <div className="mt-1.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{hint}</div>}
            </div>
          ))}
        </div>
      </InView>

      <InView as="section" className="sec">
        <SigHead n={1} of={2} label="Profile" title="Where they comment, and how." />
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="mono mb-5" style={{ fontSize: 10 }}>Channels</div>
            <ul className="space-y-6">{stats.channels.map((c) => (
              <li key={c.id}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <Link href={`/people/${id}?c=${c.id}`} className="truncate text-[15px] hover:text-[var(--cyan)]">{c.title}</Link>
                  <span className="mono shrink-0" style={{ fontSize: 10 }}>{c.comments} / mood <span style={{ color: moodCol(c.avg_sentiment) }}>{score(c.avg_sentiment)}</span></span>
                </div>
                <div className="bar"><span style={{ width: `${(c.comments / maxCh) * 100}%`, background: moodCol(c.avg_sentiment) }} /></div>
              </li>))}</ul>
          </div>
          <div className="space-y-9">
            <div>
              <div className="mono mb-4" style={{ fontSize: 10 }}>Languages</div>
              <div className="flex flex-wrap gap-2">{stats.languages.map((l) => <span key={l.language} className={tag}>{languageName(l.language)}<span className="mono" style={{ fontSize: 9.5 }}>{l.n}</span></span>)}</div>
            </div>
            <div>
              <div className="mono mb-4" style={{ fontSize: 10 }}>Usual emotions</div>
              {stats.emotions.length ? <div className="flex flex-wrap gap-2">{stats.emotions.map((e) => <span key={e.emotion} className={tag}>{EMOTIONS[e.emotion] ?? ""} {e.emotion}<span className="mono" style={{ fontSize: 9.5 }}>{e.n}</span></span>)}</div>
                : <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>Not read by the AI yet.</p>}
            </div>
          </div>
        </div>
      </InView>

      <InView as="section" className="sec">
        <SigHead n={2} of={2} label="Comments" title={`All comments (${compact(stats.comments)})`}
          action={<div className="flex w-fit gap-1 rounded-full border border-[var(--hair-2)] p-1">
            {(["newest", "most_liked"] as const).map((o) => (
              <Link key={o} href={qs({ sort: o, page: 1 })} className={`rounded-full px-3.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] transition ${order === o ? "bg-accent text-bg" : "text-ink-3 hover:text-ink"}`}>
                {o === "newest" ? "Newest" : "Most liked"}</Link>
            ))}
          </div>} />
        {list.length ? <div className="space-y-2.5">{list.map((c) => <CommentCard key={c.id} c={c} />)}</div> : <Empty>No comments on this page.</Empty>}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-4 text-[13.5px]">
            {page > 1 && <Link href={qs({ page: page - 1 })} className="pill pill-line">← Newer</Link>}
            <span className="mono" style={{ fontSize: 10.5 }}>Page {page} of {pages}</span>
            {page < pages && <Link href={qs({ page: page + 1 })} className="pill pill-line">Older →</Link>}
          </nav>
        )}
      </InView>
    </div>
  );
}
