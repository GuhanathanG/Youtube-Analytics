"use client";

import { useEffect, useRef } from "react";
import type { CommentRow } from "@/lib/queries";
import { CommentCard } from "./CommentCard";

/** Newest comments across all channels; new arrivals slide in after each live refresh. */
export function LiveFeed({ comments }: { comments: CommentRow[] }) {
  // Remember what was on screen, so only comments that arrive later animate in.
  const seen = useRef<Set<string> | null>(null);
  const known = seen.current;
  const rows = comments.map((c) => ({ c, fresh: known !== null && !known.has(c.id) }));
  useEffect(() => { seen.current = new Set(comments.map((c) => c.id)); }, [comments]);
  return (
    <div className="space-y-2.5">
      {rows.map(({ c, fresh }) => (
        <div key={c.id} className={fresh ? "anim-slide-in" : undefined}><CommentCard c={c} /></div>
      ))}
    </div>
  );
}
