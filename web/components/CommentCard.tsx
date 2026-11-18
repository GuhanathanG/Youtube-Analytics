import { Heart, MessageCircle } from "lucide-react";
import Link from "next/link";
import type { CommentRow } from "@/lib/queries";
import { EMOTIONS, languageName } from "@/lib/queries-shared";
import { ago } from "@/lib/format";
import { SentimentChip, Tag } from "./ui";

export function CommentCard({ c, showVideo = true }: { c: CommentRow; showVideo?: boolean }) {
  const edge = c.sentiment === "positive" ? "before:bg-pos before:shadow-[0_0_10px_#22e1ff]" : c.sentiment === "negative" ? "before:bg-neg before:shadow-[0_0_10px_#ff3d7f]" : "before:bg-white/20";
  return (
    <article className={`relative border border-line bg-white/[0.015] p-4 pl-5 transition hover:border-line-2 hover:bg-white/[0.03] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] ${edge}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
        {c.author_channel_id
          ? <Link href={`/people/${c.author_channel_id}${c.channel_id ? `?c=${c.channel_id}` : ""}`} className="font-medium text-ink-2 hover:text-accent" title="All comments by this person">{c.author_name ?? "Viewer"}</Link>
          : <span className="font-medium text-ink-2">{c.author_name ?? "Viewer"}</span>}
        {c.is_reply && <span>↳ reply</span>}
        {/* "3m ago" is worked out on the server and again in the browser; a minute boundary between them is fine. */}
        <span suppressHydrationWarning>{ago(c.published_at)}</span>
        {showVideo && <Link href={`/videos/${c.video_id}`} className="truncate text-ink-3 hover:text-accent">on {c.video_title}</Link>}
      </header>
      <p className="mt-2.5 whitespace-pre-line break-words text-[15px] leading-relaxed text-ink">{c.text}</p>
      {c.translation && (
        <p className="mt-1.5 border-l border-accent/40 pl-3 text-[13px] italic text-ink-2"><span className="label mr-1.5 not-italic">EN</span>{c.translation}</p>
      )}
      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <SentimentChip value={c.sentiment} ai={c.sentiment_source === "ai"} />
        {c.emotion && c.emotion !== "neutral" && <Tag>{EMOTIONS[c.emotion] ?? ""} {c.emotion}</Tag>}
        {c.is_question && <Tag tone="accent">❓ question</Tag>}
        {c.is_suggestion && <Tag tone="accent">💡 request</Tag>}
        {c.is_spam && <Tag tone="warn">spam</Tag>}
        {c.language && <Tag>{languageName(c.language)}</Tag>}
        <span className="ml-auto flex items-center gap-3 text-[12.5px] text-ink-3 tabular">
          <span className="flex items-center gap-1"><Heart size={13} />{c.like_count.toLocaleString("en")}</span>
          {c.reply_count > 0 && <span className="flex items-center gap-1"><MessageCircle size={13} />{c.reply_count}</span>}
        </span>
      </footer>
    </article>
  );
}
