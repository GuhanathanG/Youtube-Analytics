import "server-only";
import { sql } from "./db";
import { cached } from "./cache";

/** One dot in the particle field: a recent analysed comment (text trimmed; the field only needs a preview). */
export type Dot = {
  s: "positive" | "neutral" | "negative"; v: number; lang: string; emo: string; t: number; ch: string;
  text: string; who: string;
};

/** The newest analysed comments (one channel, or all watched channels; spam left out), for the Signal particle field. */
export function particleSample(limit = 6000, channelId: string | null = null): Promise<Dot[]> {
  return cached(`concept:dots:${limit}:${channelId ?? "all"}`, 120_000, async () => {
    const db = sql();
    const rows = await db`
      select c.sentiment as s, coalesce(c.sentiment_value, 0)::float8 as v, coalesce(nullif(c.language, ''), 'other') as lang,
             coalesce(nullif(c.emotion, ''), 'neutral') as emo, extract(epoch from c.published_at)::float8 as t,
             c.channel_id as ch, left(coalesce(c.translation, c.text), 160) as text, coalesce(c.author_name, '') as who
      from comments c
      where c.sentiment is not null and c.published_at is not null and not coalesce(c.is_spam, false)
        and ${channelId ? db`c.channel_id = ${channelId}` : db`true`}
      order by c.published_at desc limit ${limit}`;
    return rows as unknown as Dot[];
  });
}
