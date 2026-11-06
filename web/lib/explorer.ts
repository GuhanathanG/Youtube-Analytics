import type { CommentOrder, Filters } from "./queries";

export type ExplorerParams = Record<string, string | undefined>;

export function parseExplorer(p: ExplorerParams): { filters: Filters; order: CommentOrder; limit: number } {
  const orders: CommentOrder[] = ["newest", "oldest", "most_liked", "most_negative", "most_positive"];
  const flags = ["question", "suggestion", "spam", "toxic"] as const;
  const flag = flags.find((f) => f === p.type) ?? null;
  return {
    filters: {
      channelId: p.channel && p.channel !== "all" ? p.channel : null,
      sentiment: ["positive", "neutral", "negative"].includes(p.sentiment ?? "") ? p.sentiment! : null,
      language: p.lang || null,
      emotion: p.emotion || null,
      flag,
      search: p.q?.trim() || null,
      hideSpam: p.spam !== "show" && flag !== "spam",
    },
    order: orders.find((o) => o === p.sort) ?? "newest",
    limit: Math.min(Number(p.limit) || 100, 5000),
  };
}
