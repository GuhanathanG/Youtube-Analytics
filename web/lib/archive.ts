import "server-only";
import postgres from "postgres";
import { sql } from "./db";
import { cached } from "./cache";

/**
 * Read access to the comment archive: one or more free databases (e.g. Neon projects) that hold old
 * comments, so the main database stays small and fast. They come from ARCHIVE_DATABASE_URLS /
 * ARCHIVE_DATABASE_URL and from rows named "archive_db_*" in app_secrets (added without touching
 * Vercel settings). Search, Ask AI and commenter pages look in all of them.
 */
declare global {
  // eslint-disable-next-line no-var
  var __pgArchives: Map<string, ReturnType<typeof postgres>> | undefined;
}

type Pg = ReturnType<typeof postgres>;

function client(url: string): Pg {
  globalThis.__pgArchives ??= new Map();
  let c = globalThis.__pgArchives.get(url);
  if (!c) {
    c = postgres(url, {
      prepare: false, max: 2, idle_timeout: 5, connect_timeout: 15,
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
      types: { date: { to: 1184, from: [1082, 1083, 1114, 1184], serialize: (x: string) => x, parse: (x: string) => x } },
      transform: { undefined: null }, onnotice: () => {},
    });
    globalThis.__pgArchives.set(url, c);
  }
  return c;
}

/** Every archive database (cached for 5 minutes). */
function archiveUrls(): Promise<string[]> {
  return cached("archive-urls", 300_000, async () => {
    const env = [process.env.ARCHIVE_DATABASE_URLS ?? "", process.env.ARCHIVE_DATABASE_URL ?? ""]
      .flatMap((x) => x.split(/[,\n]/)).map((x) => x.trim()).filter(Boolean);
    const rows = await sql()`select value from app_secrets where name like 'archive_db_%' order by name`.catch(() => []);
    return [...new Set([...rows.map((r) => String(r.value).trim()).filter(Boolean), ...env])];
  });
}

async function archives(): Promise<Pg[]> {
  return (await archiveUrls()).map(client);
}

export async function archiveConfigured(): Promise<boolean> {
  return (await archiveUrls()).length > 0;
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
  if (!terms.length) return [];
  const likes = terms.map((t) => "%" + t.replace(/[%_\\]/g, "\\$&") + "%");
  const parts = await Promise.all((await archives()).map(async (a) => {
    try {
      return await a`select * from comments where ${channelId ? a`channel_id = ${channelId}` : a`true`}
        and (${likes.map((l) => a`(text ilike ${l} or translation ilike ${l})`).reduce((x, y) => a`${x} or ${y}`)})
        order by like_count desc nulls last limit ${limit}` as unknown as Row[];
    } catch (e) {
      if (!String(e).includes("does not exist")) console.log("[archive] search failed:", e instanceof Error ? e.message : e); // (empty until the first move)
      return [] as Row[];
    }
  }));
  const rows = parts.flat().sort((x, y) => Number(y.like_count ?? 0) - Number(x.like_count ?? 0)).slice(0, limit);
  return withTitles(rows);
}

/** One commenter's archived comments (newest or most liked) and their archived count. */
export async function archivedByAuthor(authorId: string, channelId: string | null, order: "newest" | "most_liked", limit: number) {
  const parts = await Promise.all((await archives()).map(async (a) => {
    try {
      const scope = channelId ? a`channel_id = ${channelId} and author_channel_id = ${authorId}` : a`author_channel_id = ${authorId}`;
      const [c] = await a`select count(*)::int as n from comments where ${scope}`;
      const rows = await a`select * from comments where ${scope}
        order by ${order === "most_liked" ? a`like_count desc nulls last, published_at desc` : a`published_at desc nulls last`} limit ${limit}`;
      return { rows: rows as unknown as Row[], count: c.n as number };
    } catch {
      return { rows: [] as Row[], count: 0 };
    }
  }));
  const key = (r: Row) => order === "most_liked" ? Number(r.like_count ?? 0) : Date.parse(String(r.published_at ?? "").replace(" ", "T") + "Z") || 0;
  const rows = parts.flatMap((p) => p.rows).sort((x, y) => key(y) - key(x)).slice(0, limit);
  return { rows: await withTitles(rows), count: parts.reduce((n, p) => n + p.count, 0) };
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
