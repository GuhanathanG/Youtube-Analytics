"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { CommentRow } from "@/lib/queries";
import { CommentCard } from "./CommentCard";

/** Newest comments across all channels; new arrivals slide in after each live refresh. */
export function LiveFeed({ comments }: { comments: CommentRow[] }) {
  return (
    <div className="space-y-2.5">
      <AnimatePresence initial={false}>
        {comments.map((c) => (
          <motion.div key={c.id} layout initial={{ opacity: 0, y: -12, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
            <CommentCard c={c} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
