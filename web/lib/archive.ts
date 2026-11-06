import "server-only";
import postgres from "postgres";
import { sql } from "./db";

/**
 * Read access to the comment archive (ARCHIVE_DATABASE_URL, e.g. a free Neon database). The
 * background job moves old, already-analysed comments there when the main database fills up;
 * search, Ask AI and commenter pages look there too, so nothing is "lost" from the website.
 */
declare global {
  // eslint-disable-next-line no-var
  var __pgArchive: ReturnType<typeof postgres> | undefined;
}

export const archiveConfigured = () => !!process.env.ARCHIVE_DATABASE_URL;

function archive() {
  if (!process.env.ARCHIVE_DATABASE_URL) return null;
  if (!globalThis.__pgArchive) {
    const url = process.env.ARCHIVE_DATABASE_URL;
    globalThis.__pgArchive = postgres(url, {
      prepare: false, max: 2, idle_timeout: 5, connect_timeout: 15,
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
      types: { date: { to: 1184, from: [1082, 1083, 1114, 1184], serialize: (x: string) => x, parse: (x: string) => x } },
      transform: { undefined: null }, onnotice: () => {},
    });
  }
  return globalThis.__pgArchive;
}

type Row = Record<string, unknown>;

/** Add video and channel titles (they live in the main database). */
async function withTitles(rows: Row[]): Promise<Row[]> {
  if (!rows.length) return rows;
  const db = sql();
  const vids = [...new Set(rows.map((r) => r.video_id as string))];
  const t = await db`select v.id, v.title, ch.title as channel_title from videos v join channels ch on ch.id = v.channel_id where v.id in ${db(vids)}`;
  const m = new Map(t.map((r) => [r.id as string, r]));
  return rows.map((r) => ({ ...r, video_title: m.get(r.video_id as string)?.title ?? "(archived video)",
    channel_title: m.get(r.video_id as string)?.channel_title ?? "", is_reply: r.parent_id != null, archived: true }));
}

/** Archived comments matching any of the search terms (text or English translation). */
export async function searchArchive(terms: string[], channelId: string | null, limit = 40): Promise<Row[]> {
  const a = archive();
  if (!a || !terms.length) return [];
  try {
    const likes = terms.map((t) => "%" + t.replace(/[%_\\]/g, "\\$&") + "%");
    const rows = await a`select * from comments where ${channelId ? a`channel_id = ${channelId}` : a`true`}
      and (${likes.map((l) => a`(text ilike ${l} or translation ilike ${l})`).reduce((x, y) => a`${x} or ${y}`)})
      order by like_count desc nulls last limit ${limit}`;
    return withTitles(rows as unknown as Row[]);
  } catch (e) {
    if (!String(e).includes("does not exist")) console.log("[archive] search failed:", e instanceof Error ? e.message : e); // (empty until the first move)
    return [];
  }
}

/** One commenter's archived comments (newest or most liked) and their archived count. */
export async function archivedByAuthor(authorId: string, channelId: string | null, order: "newest" | "most_liked", limit: number) {
  const a = archive();
  if (!a) return { rows: [] as Row[], count: 0 };
  try {
    const scope = channelId ? a`channel_id = ${channelId} and author_channel_id = ${authorId}` : a`author_channel_id = ${authorId}`;
    const [c] = await a`select count(*)::int as n from comments where ${scope}`;
    const rows = await a`select * from comments where ${scope}
      order by ${order === "most_liked" ? a`like_count desc nulls last, published_at desc` : a`published_at desc nulls last`} limit ${limit}`;
    return { rows: await withTitles(rows as unknown as Row[]), count: c.n as number };
  } catch {
    return { rows: [] as Row[], count: 0 };
  }
}

/** Totals of archived comments per channel (kept in the main database by the background job). */
export async function archivedTotals(channelId: string) {
  try {
    const [r] = await sql()`select coalesce(sum(comments), 0)::int as comments, coalesce(sum(positive), 0)::int as positive,
        coalesce(sum(neutral), 0)::int as neutral, coalesce(sum(negative), 0)::int as negative,
        coalesce(sum(sentiment_sum), 0)::float8 as sentiment_sum, coalesce(sum(sentiment_n), 0)::int as sentiment_n,
        coalesce(sum(analyzed), 0)::int as analyzed, coalesce(sum(ai_read), 0)::int as ai_read
      from archive_stats where channel_id = ${channelId}`;
    return r as { comments: number; positive: number; neutral: number; negative: number; sentiment_sum: number; sentiment_n: number; analyzed: number; ai_read: number };
  } catch {
    return null; // nothing archived yet (table doesn't exist)
  }
}
