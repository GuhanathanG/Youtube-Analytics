import { type NextRequest } from "next/server";
import { parseExplorer } from "@/lib/explorer";
import { comments } from "@/lib/queries";
import { csvCell } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { filters, order } = parseExplorer(p);
  const rows = await comments(filters, order, 5000);
  const cols = ["published_at", "channel_title", "video_title", "author_name", "text", "translation", "sentiment",
    "sentiment_value", "emotion", "language", "is_question", "is_suggestion", "is_spam", "like_count", "reply_count", "video_id", "id"] as const;
  const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="comments.csv"` },
  });
}
