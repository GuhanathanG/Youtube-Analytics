import "server-only";
import { sql } from "./db";
import type { CommentRow } from "./queries";
import { archivedByAuthor } from "./archive";

/**
 * One commenter: every comment they wrote on the watched channels, with their stats.
 * Scoped to one channel when known (uses the channel index, fast); otherwise across all channels.
 */
export type PersonStats = {
  name: string | null; comments: number; likes: number; avg_sentiment: number | null; first_at: string | null; last_at: string | null;
  questions: number; requests: number; videos: number;
  channels: { id: string; title: string; comments: number; avg_sentiment: number | null }[];
  languages: { language: string; n: number }[]; emotions: { emotion: string; n: number }[];
};

export async function personStats(authorId: string, channelId: string | null): Promise<PersonStats | null> {
  const db = sql();
  const scope = channelId ? db`c.channel_id = ${channelId} and c.author_channel_id = ${authorId}` : db`c.author_channel_id = ${authorId}`;
  const [s] = await db`select max(c.author_name) as name, count(*)::int as comments, coalesce(sum(c.like_count), 0)::int as likes,
      avg(c.sentiment_value)::float8 as avg_sentiment, min(c.published_at) as first_at, max(c.published_at) as last_at,
      count(*) filter (where c.is_question)::int as questions, count(*) filter (where c.is_suggestion)::int as requests,
      count(distinct c.video_id)::int as videos
    from comments c where ${scope}`;
  const archived = await archivedByAuthor(authorId, channelId, "newest", 0);
  if (!s || !((s.comments as number) + archived.count)) return null;
  s.comments = (s.comments as number) + archived.count;
  const [channels, languages, emotions] = await Promise.all([
    db`select ch.id, ch.title, count(*)::int as comments, avg(c.sentiment_value)::float8 as avg_sentiment
       from comments c join channels ch on ch.id = c.channel_id where ${scope} group by ch.id, ch.title order by 3 desc`,
    db`select coalesce(c.language, 'und') as language, count(*)::int as n from comments c where ${scope} group by 1 order by 2 desc limit 5`,
    db`select c.emotion, count(*)::int as n from comments c where ${scope} and c.emotion is not null and c.emotion <> 'neutral' group by 1 order by 2 desc limit 5`,
  ]);
  return { ...(s as unknown as PersonStats), channels: channels as never, languages: languages as never, emotions: emotions as never };
}

export async function personComments(authorId: string, channelId: string | null, order: "newest" | "most_liked", page: number, perPage = 50): Promise<CommentRow[]> {
  const live = await personLive(authorId, channelId, order, page * perPage);
  const { rows: old } = await archivedByAuthor(authorId, channelId, order, page * perPage);
  if (!old.length) return live.slice((page - 1) * perPage);
  const key = (c: CommentRow) => (order === "most_liked" ? c.like_count : Date.parse(String(c.published_at ?? 0)));
  return [...live, ...(old as unknown as CommentRow[])].sort((a, b) => key(b) - key(a)).slice((page - 1) * perPage, page * perPage);
}

async function personLive(authorId: string, channelId: string | null, order: "newest" | "most_liked", limit: number): Promise<CommentRow[]> {
  const db = sql();
  const scope = channelId ? db`c.channel_id = ${channelId} and c.author_channel_id = ${authorId}` : db`c.author_channel_id = ${authorId}`;
  return (await db`
    select c.id, c.video_id, v.title as video_title, ch.title as channel_title, c.channel_id, c.author_channel_id, c.published_at, c.author_name,
           c.text, c.translation, c.like_count, c.reply_count, c.sentiment, c.sentiment_value::float8 as sentiment_value,
           c.sentiment_source, c.emotion, c.language, c.is_question, c.is_suggestion, c.is_spam,
           (c.parent_id is not null) as is_reply, c.aspects
    from comments c join videos v on v.id = c.video_id join channels ch on ch.id = c.channel_id
    where ${scope}
    order by ${order === "most_liked" ? db`c.like_count desc, c.published_at desc` : db`c.published_at desc nulls last`}
    limit ${limit}`) as unknown as CommentRow[];
}
