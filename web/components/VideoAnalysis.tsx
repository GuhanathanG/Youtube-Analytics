import { Clapperboard, ExternalLink, Info } from "lucide-react";
import type { Moment, Performance, VideoAnalysis } from "@/lib/video";
import type { VideoAdvanced } from "@/lib/analytics";
import type { ThumbData } from "@/lib/thumbnails";
import { OutlierBadge, times } from "./AnalyticsParts";
import { ago, compact } from "@/lib/format";
import { AnalyseButton } from "./AnalyseButton";
import { Empty, Panel, Tag } from "./ui";

const toSec = (t: string) => t.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
const ytAt = (id: string, t: string | number) => `https://www.youtube.com/watch?v=${id}&t=${typeof t === "number" ? t : toSec(t)}s`;
const pct = (x: number | null, digits = 1) => (x == null ? "–" : `${(x * 100).toFixed(digits)}%`);

function Tile({ label, value, sub, note }: { label: string; value: string; sub?: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      <div className="label">{label}</div>
      <div className="mt-1.5 font-[family-name:var(--font-display)] text-2xl font-semibold tabular text-ink">{value}</div>
      {sub && <div className="mt-1 text-[12.5px] text-ink-2">{sub}</div>}
      {note && <div className="mt-1 text-[11.5px] text-ink-3">{note}</div>}
    </div>
  );
}

const rank = (p: number | null) => (p == null ? undefined : p >= 90 ? `top ${100 - p || 1}% of this channel's videos` : `beats ${p}% of this channel's videos`);

function AdvancedRow({ adv }: { adv: VideoAdvanced }) {
  const early = adv.views24 !== null && adv.median24 ? adv.views24 / adv.median24 : null;
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-line bg-white/[0.02] p-4">
        <div className="label">Outlier score</div>
        <div className="mt-1.5 flex items-center gap-2"><span className="font-[family-name:var(--font-display)] text-2xl font-semibold tabular text-ink">{times(adv.outlier)}</span><OutlierBadge value={adv.outlier} /></div>
        <div className="mt-1 text-[12.5px] text-ink-2">{adv.outlier === null ? "Shown once the video is 3 days old" : `vs a typical ${adv.format.toLowerCase()} here (${compact(adv.typicalViews)} views)`}</div>
      </div>
      <div className="rounded-xl border border-line bg-white/[0.02] p-4">
        <div className="label">First 24 hours</div>
        <div className="mt-1.5 font-[family-name:var(--font-display)] text-2xl font-semibold tabular text-ink">{adv.views24 !== null ? compact(adv.views24) : "–"}</div>
        <div className="mt-1 text-[12.5px] text-ink-2">{early !== null ? `${times(early)} the channel's usual ${compact(adv.median24)}` : "Needs a snapshot from around 24 h after upload"}</div>
      </div>
      <div className="rounded-xl border border-line bg-white/[0.02] p-4">
        <div className="label">View forecast</div>
        <div className="mt-1.5 font-[family-name:var(--font-display)] text-2xl font-semibold tabular text-ink">{adv.forecast ? compact(adv.forecast.d30) : "–"}</div>
        <div className="mt-1 text-[12.5px] text-ink-2">{adv.forecast ? `by day 30 · ${compact(adv.forecast.d7)} a week from now` : adv.ageDays >= 30 ? "Forecasts are for videos under 30 days old" : "Needs a few more hours of tracking"}</div>
        <div className="mt-1 text-[11.5px] text-ink-3">Rough trend from this video&apos;s own view history</div>
      </div>
    </div>
  );
}

export function PerformancePanel({ perf, adv }: { perf: Performance; adv?: VideoAdvanced | null }) {
  return (
    <Panel title="Performance" subtitle="Compared with this channel's other videos (older than 3 days)">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Views" value={compact(perf.views)} sub={rank(perf.percentile.views)}
          note={perf.views_per_day ? `${compact(perf.views_per_day)} per day since upload` : `in the first ${Math.max(1, Math.round(perf.age_days * 24))} h`} />
        <Tile label="Like rate" value={pct(perf.like_rate, 2)} sub={`${compact(perf.likes)} likes · channel usual ${pct(perf.channel.like_rate, 2)}`}
          note={rank(perf.percentile.like_rate)} />
        <Tile label="Comment rate" value={pct(perf.comment_rate, 2)} sub={`${compact(perf.comments)} comments · usual ${pct(perf.channel.comment_rate, 2)}`}
          note={rank(perf.percentile.comment_rate)} />
        <Tile label="Dislikes (estimate)" value={perf.dislikes_estimate != null ? compact(perf.dislikes_estimate) : "–"}
          sub={perf.dislike_ratio != null ? `${pct(perf.dislike_ratio)} of all ratings` : "no estimate available"}
          note="Community estimate from Return YouTube Dislike; YouTube hides real dislikes" />
      </div>
      {adv && <AdvancedRow adv={adv} />}
      <p className="mt-3 flex items-start gap-2 text-[12px] text-ink-3"><Info size={13} className="mt-0.5 shrink-0" />
        Shares, watch time and audience retention are only visible to the channel's owner, so YouTube doesn't provide them for other creators' videos.</p>
    </Panel>
  );
}

export function DetailsPanel({ perf }: { perf: Performance }) {
  const m = perf.meta;
  return (
    <Panel title="Video details" subtitle="From YouTube">
      <div className="flex flex-wrap gap-2 text-[12.5px]">
        {m.category && <Tag>Category: {m.category}</Tag>}
        {m.definition && <Tag>{m.definition.toUpperCase()}</Tag>}
        {m.captions != null && <Tag>{m.captions ? "Has captions" : "No captions"}</Tag>}
        {m.language && <Tag>Language: {m.language}</Tag>}
        {m.topics.map((t) => <Tag key={t} tone="accent">{t}</Tag>)}
      </div>
      {m.tags.length > 0 && (
        <div className="mt-3"><div className="label mb-1.5">Tags</div>
          <div className="flex flex-wrap gap-1.5">{m.tags.map((t) => <span key={t} className="rounded-md bg-white/5 px-2 py-0.5 text-[12px] text-ink-2">{t}</span>)}</div>
        </div>
      )}
      {!m.category && !m.tags.length && <p className="text-[13px] text-ink-3">Details appear after the next stats refresh.</p>}
    </Panel>
  );
}

type Chapter = { start: string; title: string; summary?: string };
type KeyMoment = { time: string; what: string; why?: string };

function List({ title, items, tone }: { title: string; items: unknown; tone?: "pos" | "neg" }) {
  const list = Array.isArray(items) ? (items.filter(Boolean) as string[]) : [];
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      <div className="mb-2 text-[13px] font-medium text-ink">{title}</div>
      <ul className="space-y-1.5">{list.slice(0, 8).map((t, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] text-ink-2"><span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${tone === "pos" ? "bg-pos" : tone === "neg" ? "bg-neg" : "bg-accent"}`} />{t}</li>
      ))}</ul>
    </div>
  );
}

export function AIWatchPanel({ videoId, analysis, hasKey }: { videoId: string; analysis: VideoAnalysis | null; hasKey: boolean }) {
  const d = analysis?.status === "done" ? (analysis.data as Record<string, unknown>) : null;
  if (!d) {
    return (
      <Panel title={<span className="flex items-center gap-2"><Clapperboard size={16} className="text-accent" />AI watched the video</span>}
        subtitle="Gemini watches the video (pictures and sound) and explains what happens, chapter by chapter">
        {analysis?.status === "skipped" || analysis?.status === "error" ? <p className="mb-3 text-[13px] text-warn">{analysis.error}</p> : null}
        {hasKey ? <AnalyseButton videoId={videoId} again={!!analysis} /> : <Empty>Needs GEMINI_API_KEY in Vercel.</Empty>}
        <p className="mt-3 text-[12px] text-ink-3">New uploads are analysed automatically. Free limit: about 8 hours of video a day. Takes 1–3 minutes.</p>
      </Panel>
    );
  }
  const hook = d.hook as { first_30s?: string; strength?: string; why?: string } | undefined;
  const prod = d.production as { editing?: string; audio?: string; visuals?: string } | undefined;
  const sponsors = (d.sponsor_segments as { start: string; end: string; brand: string }[] | undefined) ?? [];
  return (
    <Panel title={<span className="flex items-center gap-2"><Clapperboard size={16} className="text-accent" />AI watched the video</span>}
      subtitle={`Analysed ${ago(analysis!.created_at)} · ${analysis!.model}`}>
      <div className="flex flex-wrap gap-2">
        {typeof d.format === "string" && <Tag tone="accent">{d.format}</Tag>}
        {typeof d.tone === "string" && <Tag>{d.tone}</Tag>}
        {((d.languages as string[] | undefined) ?? []).map((l) => <Tag key={l}>{l}</Tag>)}
      </div>
      {typeof d.summary === "string" && <p className="mt-3 max-w-[85ch] text-[15px] leading-relaxed text-ink">{d.summary}</p>}

      {hook && (
        <div className="mt-4 rounded-xl border border-line bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink">First 30 seconds (the hook)
            {hook.strength && <Tag tone={hook.strength === "strong" ? "accent" : hook.strength === "weak" ? "warn" : "default"}>{hook.strength}</Tag>}</div>
          <p className="mt-1.5 text-[13.5px] text-ink-2">{hook.first_30s}</p>
          {hook.why && <p className="mt-1 text-[12.5px] text-ink-3">{hook.why}</p>}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="label mb-2">Chapters</div>
          <ol className="space-y-1">
            {((d.chapters as Chapter[] | undefined) ?? []).map((c, i) => (
              <li key={i}><a href={ytAt(videoId, c.start)} target="_blank" rel="noreferrer" className="flex gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                <span className="w-12 shrink-0 font-mono text-[12.5px] text-accent">{c.start}</span>
                <span className="min-w-0"><span className="block text-[13.5px] text-ink">{c.title}</span>
                  {c.summary && <span className="block text-[12.5px] text-ink-3">{c.summary}</span>}</span>
              </a></li>
            ))}
          </ol>
        </div>
        <div>
          <div className="label mb-2">Key moments</div>
          <ul className="space-y-1">
            {((d.key_moments as KeyMoment[] | undefined) ?? []).map((k, i) => (
              <li key={i}><a href={ytAt(videoId, k.time)} target="_blank" rel="noreferrer" className="flex gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                <span className="w-12 shrink-0 font-mono text-[12.5px] text-accent">{k.time}</span>
                <span className="min-w-0"><span className="block text-[13.5px] text-ink">{k.what}</span>
                  {k.why && <span className="block text-[12.5px] text-ink-3">{k.why}</span>}</span>
              </a></li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <List title="💪 Strengths" items={d.strengths} tone="pos" />
        <List title="🔧 Could be better" items={d.weaknesses} tone="neg" />
        <List title="🏷️ People, brands & products" items={d.people_brands_products} />
        <List title="📣 Calls to action" items={d.calls_to_action} />
        <List title="🗂️ Topics" items={d.topics} />
        {prod && (
          <div className="rounded-xl border border-line bg-white/[0.02] p-4 text-[13px] text-ink-2">
            <div className="mb-2 font-medium text-ink">🎬 Production</div>
            {prod.editing && <p><span className="text-ink-3">Editing:</span> {prod.editing}</p>}
            {prod.audio && <p className="mt-1"><span className="text-ink-3">Audio:</span> {prod.audio}</p>}
            {prod.visuals && <p className="mt-1"><span className="text-ink-3">Visuals:</span> {prod.visuals}</p>}
          </div>
        )}
      </div>
      {sponsors.length > 0 && (
        <p className="mt-3 text-[13px] text-ink-2">💰 Sponsor segments: {sponsors.map((s) => `${s.brand} (${s.start}–${s.end})`).join(", ")}</p>
      )}
      {typeof d.title_thumbnail_promise === "string" && <p className="mt-2 text-[13px] text-ink-2"><span className="label mr-2">Title promise</span>{d.title_thumbnail_promise}</p>}
      {typeof d.audience_fit === "string" && <p className="mt-2 text-[13px] text-ink-2"><span className="label mr-2">Audience</span>{d.audience_fit}</p>}
      <div className="mt-4"><AnalyseButton videoId={videoId} again /></div>
    </Panel>
  );
}

export function MomentsPanel({ videoId, durationS, moments, histogram, chapters }:
  { videoId: string; durationS: number; moments: Moment[]; histogram: { second: number; mentions: number }[]; chapters: Chapter[] }) {
  const chapterAt = (s: number) => [...chapters].reverse().find((c) => toSec(c.start) <= s)?.title;
  const max = Math.max(1, ...histogram.map((h) => h.mentions));
  const span = Math.max(durationS, ...histogram.map((h) => h.second + 20), 60);
  return (
    <Panel title="Most-discussed moments" subtitle="From timestamps viewers write in their comments (like “2:35 😂”)">
      {!moments.length ? <Empty>No viewer has mentioned a timestamp yet.</Empty> : (
        <>
          <div className="relative h-16 rounded-lg bg-white/[0.03]" role="img" aria-label="Where in the video viewers point to">
            {histogram.map((h) => (
              <a key={h.second} href={ytAt(videoId, h.second)} target="_blank" rel="noreferrer" title={`${h.mentions} comment(s) at ${Math.floor(h.second / 60)}:${String(h.second % 60).padStart(2, "0")}`}
                className="absolute bottom-0 rounded-t bg-accent/80 hover:bg-accent"
                style={{ left: `${(h.second / span) * 100}%`, width: `max(3px, ${(20 / span) * 100}%)`, height: `${Math.max(8, (h.mentions / max) * 100)}%` }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-3"><span>0:00</span><span>{Math.floor(span / 60)}:{String(span % 60).padStart(2, "0")}</span></div>
          <ol className="mt-4 grid gap-2 md:grid-cols-2">
            {moments.map((m) => (
              <li key={m.second} className="rounded-xl border border-line bg-white/[0.02] p-3">
                <a href={ytAt(videoId, m.second)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13.5px] text-ink hover:text-accent">
                  <span className="font-mono text-accent">{m.label}</span>{chapterAt(m.second) && <span className="truncate text-ink-2">· {chapterAt(m.second)}</span>}
                  <span className="ml-auto shrink-0 text-[12px] text-ink-3">{m.mentions} mention{m.mentions === 1 ? "" : "s"}</span><ExternalLink size={12} />
                </a>
                {m.examples.slice(0, 2).map((e, i) => <p key={i} className="mt-1.5 line-clamp-2 text-[12.5px] text-ink-3">“{e.text}”</p>)}
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}

/** What the AI sees in this video's thumbnail. */
export function ThumbnailPanel({ t }: { t: ThumbData }) {
  return (
    <Panel title="Thumbnail check" subtitle="What the AI sees in the thumbnail">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Faces" value={String(t.faces ?? 0)} sub={t.faces ? `looks ${t.face_emotion ?? "–"}` : "no face"} />
        <Tile label="Text" value={`${t.text_words ?? 0} words`} sub={t.text ? `“${t.text.slice(0, 60)}”` : "no text"} note={t.readability ? `readability on a phone: ${t.readability}` : undefined} />
        <Tile label="Look" value={t.brightness ?? "–"} sub={`${t.contrast ?? "–"} contrast`} note={(t.main_colors ?? []).join(", ")} />
        <Tile label="Clickbait" value={`${t.clickbait ?? "–"}/10`} sub={t.style} />
      </div>
      {t.subject && <p className="mt-3 text-[13px] text-ink-2">Shows: {t.subject}{(t.elements ?? []).length ? ` · ${(t.elements ?? []).join(", ")}` : ""}</p>}
    </Panel>
  );
}
