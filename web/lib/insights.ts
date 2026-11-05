import "server-only";
import { sql } from "./db";
import { aiSlots, chatJson } from "./ai";

/**
 * AI briefings per video and per channel, written by the website engine (same prompts
 * and rules as the Python worker): a video gets a new briefing when it reaches 20 comments
 * or its comments grow by 25% (and 20+); a channel once a day when it has new comments.
 */
const VIDEO_SYSTEM = "You are an audience-research analyst. You get statistics and a sample of viewer\ncomments (any language) for one YouTube video. Write findings in clear, simple English,\ngrounded only in the comments - quote or paraphrase real comments, never invent.\n\nReply with JSON only:\n{\n \"summary\": \"3-4 sentences: how the audience reacted overall and why\",\n \"mood\": \"one short phrase\",\n \"liked\": [\"what viewers praised\", ...],\n \"complaints\": [\"what viewers criticised\", ...],\n \"requests\": [\"content or changes viewers asked for\", ...],\n \"questions\": [\"important unanswered viewer questions\", ...],\n \"topics\": [{\"name\": \"short topic\", \"share_pct\": number, \"sentiment\": \"positive|neutral|negative|mixed\",\n             \"example\": \"a representative comment (original language) + English meaning if needed\"}],\n \"language_notes\": \"which languages viewers used and any difference in their reactions\"\n}\nUse at most 6 items per list, most important first. Use [] when there is nothing.";

const CHANNEL_SYSTEM = "You are an audience-research analyst. You get per-video statistics and a sample\nof recent viewer comments (any language) for one YouTube channel. Write findings in clear,\nsimple English, grounded only in the data - never invent.\n\nReply with JSON only:\n{\n \"summary\": \"4-5 sentences: the state of this audience recently\",\n \"trend\": \"is sentiment improving, stable or declining, and why\",\n \"audience_profile\": \"who seems to be watching (languages, regions, interests) based on comments\",\n \"liked\": [\"recurring praise\", ...],\n \"complaints\": [\"recurring criticism\", ...],\n \"requests\": [\"recurring content requests\", ...],\n \"best_videos\": [\"video title - why it resonated\", ...],\n \"worst_videos\": [\"video title - what went wrong\", ...],\n \"content_ideas\": [\"concrete video ideas this audience is asking for\", ...],\n \"topics\": [{\"name\": \"short topic\", \"share_pct\": number, \"sentiment\": \"positive|neutral|negative|mixed\"}]\n}\nUse at most 6 items per list, most important first. Use [] when there is nothing.";

const MIN_COMMENTS = 20;

type Row = Record<string, unknown>;
// A postgres.js SQL fragment (a "where" clause shared by several queries).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Frag = any;

async function sample(where: Frag, perBucket = 60, cap = 220) {
  const db = sql();
  const buckets = await Promise.all([
    db`select c.* from comments c where ${where} order by like_count desc limit ${perBucket}`,
    db`select c.* from comments c where ${where} order by published_at desc nulls last limit ${perBucket}`,
    db`select c.* from comments c where ${where} and sentiment_value is not null order by sentiment_value asc limit ${perBucket}`,
    db`select c.* from comments c where ${where} and (is_question or is_suggestion) order by like_count desc limit ${perBucket}`,
  ]);
  const seen = new Map<string, Row>();
  for (const b of buckets) for (const r of b) if (seen.size < cap && !r.is_spam && !seen.has(r.id as string)) seen.set(r.id as string, r);
  return [...seen.values()];
}

function formatComments(rows: Row[]) {
  return rows.map((c) => {
    let text = String(c.text ?? "").split(/\s+/).join(" ").slice(0, 300);
    if (c.translation) text += `  [EN: ${String(c.translation).slice(0, 200)}]`;
    return `- (${c.sentiment ?? "?"}, ${c.like_count} likes) ${text}`;
  }).join("\n");
}

async function statsBlock(where: Frag) {
  const db = sql();
  const [sent, langs, emos, aspects] = await Promise.all([
    db`select coalesce(sentiment, 'pending') s, count(*)::int n from comments c where ${where} group by 1`,
    db`select language l, count(*)::int n from comments c where ${where} group by 1 order by 2 desc limit 8`,
    db`select emotion e, count(*)::int n from comments c where ${where} and emotion is not null group by 1 order by 2 desc limit 6`,
    db`select aspects from comments c where ${where} and aspects is not null limit 5000`,
  ]);
  const counts = new Map<string, number>();
  for (const r of aspects) for (const p of String(r.aspects).split(",")) if (p.includes(":")) counts.set(p, (counts.get(p) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return [
    `Sentiment counts: ${JSON.stringify(Object.fromEntries(sent.map((r) => [r.s, r.n])))}`,
    `Languages: ${langs.map((r) => `${r.l ?? "?"}=${r.n}`).join(", ")}`,
    `Emotions: ${emos.map((r) => `${r.e}=${r.n}`).join(", ") || "n/a"}`,
    `Aspects (aspect:polarity=count): ${top.map(([k, n]) => `${k}=${n}`).join(", ") || "n/a"}`,
  ].join("\n");
}

async function save(scope: string, id: string, total: number, data: Record<string, unknown>, model: string) {
  await sql()`insert into insights (scope, target_id, created_at, comment_count, model, data)
    values (${scope}, ${id}, (now() at time zone 'utc'), ${total}, ${model.slice(0, 100)}, ${JSON.stringify(data)})`;
}

/** Write up to `max` due briefings before `deadline`. Returns how many were written. */
export async function writeDueInsights(deadline: number, max = 2): Promise<number> {
  if (!aiSlots().length) return 0;
  const db = sql();
  let written = 0;

  const dueVideos = await db`
    with counts as (select video_id, count(*)::int n from comments group by video_id having count(*) >= ${MIN_COMMENTS}),
         last as (select distinct on (target_id) target_id, comment_count from insights where scope = 'video' order by target_id, created_at desc)
    select v.id, v.title, v.published_at, v.view_count, v.like_count, c.n
    from counts c join videos v on v.id = c.video_id join channels ch on ch.id = v.channel_id
    left join last l on l.target_id = v.id
    where ch.active and (l.target_id is null or (c.n >= l.comment_count * 1.25 and c.n - l.comment_count >= 20))
    order by v.published_at desc nulls last limit ${max}`;
  for (const v of dueVideos) {
    if (Date.now() > deadline - 12000 || written >= max) break;
    const where = db`c.video_id = ${v.id as string}`;
    const rows = await sample(where);
    const prompt = [`Video: ${v.title}`, v.published_at ? `Published: ${String(v.published_at).slice(0, 10)}` : "",
      `Views: ${v.view_count}, likes: ${v.like_count}, comments stored: ${v.n}`, await statsBlock(where),
      `\nSample of ${rows.length} comments (most liked, newest, most negative, questions):`, formatComments(rows)].join("\n");
    const out = await chatJson(VIDEO_SYSTEM, prompt, 4000, deadline);
    if (!out) return written;
    await save("video", v.id as string, v.n as number, out.data, out.model);
    written++;
  }

  const dueChannels = await db`
    with totals as (select channel_id, count(*)::int n from comments group by channel_id having count(*) >= ${MIN_COMMENTS}),
         last as (select distinct on (target_id) target_id, comment_count, created_at from insights where scope = 'channel' order by target_id, created_at desc)
    select ch.id, ch.title, ch.handle, ch.subscriber_count, t.n
    from totals t join channels ch on ch.id = t.channel_id left join last l on l.target_id = ch.id
    where ch.active and (l.target_id is null or (l.created_at < (now() at time zone 'utc') - interval '24 hours' and t.n <> l.comment_count))
    limit 1`;
  for (const ch of dueChannels) {
    if (Date.now() > deadline - 12000 || written >= max) break;
    const recentWhere = db`c.channel_id = ${ch.id as string} and c.published_at >= (now() at time zone 'utc') - interval '30 days'`;
    const [{ n: nRecent }] = await db`select count(*)::int n from comments c where ${recentWhere}`;
    const useRecent = (nRecent as number) >= MIN_COMMENTS;
    const where = useRecent ? recentWhere : db`c.channel_id = ${ch.id as string}`;
    const perVideo = await db`
      select v.title, v.published_at, v.view_count, count(c.id)::int n, avg(c.sentiment_value)::float8 s
      from videos v join comments c on c.video_id = v.id where v.channel_id = ${ch.id as string}
      group by v.id, v.title, v.published_at, v.view_count order by v.published_at desc nulls last limit 25`;
    const rows = await sample(where, 70, 260);
    const prompt = [`Channel: ${ch.title} (${ch.handle ?? ch.id}), subscribers: ${ch.subscriber_count}`,
      `Comments stored in total: ${ch.n}; analysed window: ${useRecent ? "last 30 days" : "all time"}`, await statsBlock(where),
      "\nRecent videos (date | title | views | comments | sentiment -100..+100):",
      ...perVideo.map((r) => `- ${String(r.published_at ?? "").slice(0, 10)} | ${r.title} | views ${r.view_count} | comments ${r.n} | sentiment ${Math.round(((r.s as number) ?? 0) * 100)}`),
      `\nSample of ${rows.length} comments:`, formatComments(rows)].join("\n");
    const out = await chatJson(CHANNEL_SYSTEM, prompt, 4000, deadline);
    if (!out) return written;
    await save("channel", ch.id as string, ch.n as number, out.data, out.model);
    written++;
  }
  return written;
}
