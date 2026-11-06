import "server-only";
import { sql } from "./db";
import { chatJson } from "./ai";
import { cached } from "./cache";

/**
 * Creator Memory: how the AI "knows" a creator without re-reading every comment.
 *  1. Monthly memory (scope "month", target "<channel>:<YYYY-MM>"): one AI summary per channel per month,
 *     from that month's statistics, a balanced sample of comments, its videos and their briefings.
 *     Past months are written once; the current and previous month are refreshed as comments grow.
 *  2. Creator profile (scope "profile", target channel): rebuilt from all monthly memories, so the AI
 *     understands the whole history: who the audience is, what they love, what changed over time.
 * Ask AI reads these alongside matching comments. Because the memory keeps the understanding,
 * old raw comments can later be archived without the AI forgetting.
 */

const MONTH_SYSTEM = `You are an audience-research analyst writing a monthly memory of one YouTube creator's audience.
You get the month's statistics, its videos (with AI briefings when available), a balanced sample of viewer comments
(any language, including Tanglish/Hinglish) and last month's memory. Ground everything in the data; never invent.
Reply with JSON only:
{"summary": "4-6 sentences: what happened this month and how the audience reacted",
 "mood": "short phrase", "audience": "who was commenting (languages, regions, types of fans)",
 "liked": ["..."], "complaints": ["..."], "requests": ["..."], "themes": ["main discussion themes"],
 "notable_videos": ["title - why it mattered"], "changes": "what changed compared with last month (or 'first month on record')"}
At most 5 items per list.`;

const PROFILE_SYSTEM = `You are an audience-research analyst. From a creator's monthly memories (oldest first) and current
statistics, write a long-term profile of the creator and their audience. Ground everything in the memories; never invent.
Reply with JSON only:
{"one_line": "one sentence describing this creator and audience",
 "creator": "what the creator makes and their style, as viewers see it",
 "audience": "who watches and comments (languages, regions, interests, loyal fans)",
 "strengths": ["..."], "weaknesses": ["..."], "recurring_requests": ["..."], "recurring_complaints": ["..."],
 "evolution": "how the audience and its reactions changed over time, with months",
 "key_moments": [{"month": "YYYY-MM", "what": "..."}],
 "opportunities": ["concrete suggestions based on the history"]}
At most 6 items per list.`;

type Row = Record<string, unknown>;
const parse = (s: unknown): Record<string, unknown> => { try { const v = JSON.parse(String(s ?? "{}")); return v && typeof v === "object" ? v : {}; } catch { return {}; } };

async function save(scope: string, id: string, total: number, data: Record<string, unknown>, model: string) {
  await sql()`insert into insights (scope, target_id, created_at, comment_count, model, data)
    values (${scope}, ${id}, (now() at time zone 'utc'), ${total}, ${model.slice(0, 100)}, ${JSON.stringify(data)})`;
}

/** Months that need a (new) memory: missing ones first (newest first), then growing recent months. Cached for 30 min. */
function dueMonths(): Promise<Row[]> {
  return cached("memory-due", Number(process.env.MEMORY_DUE_CACHE_SECONDS ?? 1800) * 1000, async () => (await sql()`
    with m as (
      -- Months are found from the small videos table (comment counts from YouTube), not by scanning every comment.
      select v.channel_id, to_char(date_trunc('month', v.published_at), 'YYYY-MM') as mon, sum(coalesce(v.comment_count, 0))::int as n
      from videos v join channels ch on ch.id = v.channel_id
      where ch.active and v.published_at >= date_trunc('month', (now() at time zone 'utc')) - interval '23 months'
      group by 1, 2 having sum(coalesce(v.comment_count, 0)) >= 20),
    last as (select distinct on (target_id) target_id, comment_count, created_at from insights
             where scope = 'month' order by target_id, created_at desc)
    select m.channel_id, m.mon, m.n, l.comment_count as prev from m left join last l on l.target_id = m.channel_id || ':' || m.mon
    where l.target_id is null
       or (m.mon >= to_char((now() at time zone 'utc') - interval '1 month', 'YYYY-MM')
           and l.created_at < (now() at time zone 'utc') - interval '3 days' and m.n >= l.comment_count * 1.2)
    order by (l.target_id is null) desc, m.mon desc
    limit 20`) as Row[]);
}

async function writeMonth(channelId: string, mon: string, deadline: number): Promise<boolean> {
  const db = sql();
  const start = `${mon}-01 00:00:00`;
  const where = db`c.channel_id = ${channelId} and c.published_at >= ${start}::timestamp and c.published_at < ${start}::timestamp + interval '1 month'`;
  const [st] = await db`select count(*)::int as n, avg(sentiment_value)::float8 as mood,
      count(*) filter (where sentiment = 'negative')::int as neg, count(distinct author_channel_id)::int as people,
      count(*) filter (where is_question)::int as questions, count(*) filter (where is_suggestion)::int as requests
    from comments c where ${where}`;
  const langs = await db`select split_part(coalesce(language, 'und'), '-', 1) as l, count(*)::int as n from comments c where ${where} group by 1 order by 2 desc limit 6`;
  const comments = [
    ...await db`select text, translation, like_count, sentiment from comments c where ${where} and (c.is_spam is null or not c.is_spam) order by like_count desc limit 70`,
    ...await db`select text, translation, like_count, sentiment from comments c where ${where} and sentiment = 'negative' order by like_count desc limit 30`,
    ...await db`select text, translation, like_count, sentiment from comments c where ${where} and (is_question or is_suggestion) order by like_count desc limit 30`,
    ...await db`select text, translation, like_count, sentiment from comments c where ${where} order by random() limit 40`,
  ];
  const seen = new Set<string>();
  const sample = comments.filter((c) => !seen.has(c.text as string) && seen.add(c.text as string)).slice(0, 160);
  const videos = await db`
    select v.title, v.view_count, v.comment_count,
      (select data from insights i where i.scope = 'video' and i.target_id = v.id order by created_at desc limit 1) as brief,
      (select data from video_analysis a where a.video_id = v.id and a.status = 'done') as watched
    from videos v where v.channel_id = ${channelId} and v.published_at >= ${start}::timestamp and v.published_at < ${start}::timestamp + interval '1 month'
    order by v.view_count desc nulls last limit 12`.catch(async () => db`
    select v.title, v.view_count, v.comment_count, null as brief, null as watched from videos v
    where v.channel_id = ${channelId} and v.published_at >= ${start}::timestamp and v.published_at < ${start}::timestamp + interval '1 month'
    order by v.view_count desc nulls last limit 12`);
  const [prev] = await db`select data from insights where scope = 'month' and target_id < ${`${channelId}:${mon}`}
    and target_id like ${`${channelId}:%`} order by target_id desc, created_at desc limit 1`;
  const prompt = [
    `Month: ${mon}`,
    `Statistics: ${st.n} comments from ${st.people} people, average mood ${st.mood === null ? "n/a" : Math.round((st.mood as number) * 100)} (−100…+100), ` +
      `${st.neg} negative, ${st.questions} questions, ${st.requests} requests. Languages: ${langs.map((l) => `${l.l}=${l.n}`).join(", ")}`,
    "", "Videos published this month (views, comments):",
    ...videos.map((v) => {
      const b = parse(v.brief), w = parse(v.watched);
      return `- ${v.title} (${v.view_count ?? "?"} views, ${v.comment_count ?? "?"} comments)` +
        (w.summary ? `\n  What happens: ${String(w.summary).slice(0, 300)}` : "") + (b.summary ? `\n  Audience reaction: ${String(b.summary).slice(0, 300)}` : "");
    }),
    "", `Last month's memory: ${prev ? String(parse(prev.data).summary ?? "").slice(0, 600) : "none (first month on record)"}`,
    "", "Comments:",
    ...sample.map((c) => `- (${c.sentiment ?? "?"}, ${c.like_count} likes) ${String(c.text).split(/\s+/).join(" ").slice(0, 240)}${c.translation ? ` [EN: ${String(c.translation).slice(0, 140)}]` : ""}`),
  ].join("\n");
  const out = await chatJson(MONTH_SYSTEM, prompt, 1800, deadline);
  if (!out) return false;
  await save("month", `${channelId}:${mon}`, st.n as number, { ...out.data, month: mon, stats: { comments: st.n, people: st.people, mood: st.mood } }, out.model);
  return true;
}

async function writeProfile(channelId: string, deadline: number): Promise<boolean> {
  const db = sql();
  const months = await db`select distinct on (target_id) target_id, data from insights
    where scope = 'month' and target_id like ${`${channelId}:%`} order by target_id, created_at desc`;
  if (!months.length) return false;
  const [ch] = await db`select title, subscriber_count, video_count from channels where id = ${channelId}`;
  const prompt = [
    `Channel: ${ch?.title} (${ch?.subscriber_count ?? "?"} subscribers, ${ch?.video_count ?? "?"} videos)`, "", "Monthly memories (oldest first):",
    ...months.map((m) => {
      const d = parse(m.data);
      const list = (k: string) => ((d[k] as string[] | undefined) ?? []).slice(0, 3).join("; ");
      return `## ${String(m.target_id).split(":")[1]}\n${String(d.summary ?? "").slice(0, 500)}\nLiked: ${list("liked")}\nComplaints: ${list("complaints")}\n` +
        `Requests: ${list("requests")}\nChanges: ${String(d.changes ?? "").slice(0, 200)}`;
    }),
  ].join("\n");
  const out = await chatJson(PROFILE_SYSTEM, prompt, 2200, deadline);
  if (!out) return false;
  await save("profile", channelId, months.length, { ...out.data, months: months.length }, out.model);
  return true;
}

/** One memory step per call (a month or a profile), so it fits the engine's short slots. */
export async function writeDueMemory(deadline: number): Promise<number> {
  const db = sql();
  // Profiles first when they're behind their monthly memories (and at most daily).
  const stale = await db`
    select ch.id from channels ch where ch.active and exists (select 1 from insights m where m.scope = 'month' and m.target_id like ch.id || ':%')
      and not exists (select 1 from insights p where p.scope = 'profile' and p.target_id = ch.id
        and (p.created_at > (now() at time zone 'utc') - interval '1 day'
             or p.created_at >= (select max(created_at) from insights m where m.scope = 'month' and m.target_id like ch.id || ':%')))
    limit 1`;
  if (stale.length && Date.now() < deadline - 8000) return (await writeProfile(stale[0].id as string, deadline)) ? 1 : 0;
  const due = await dueMonths();
  if (!due.length || Date.now() > deadline - 8000) return 0;
  const next = due[0];
  const ok = await writeMonth(next.channel_id as string, next.mon as string, deadline);
  if (ok) due.shift(); // drop it from the cached list
  return ok ? 1 : 0;
}

/* ------------------------------------------------------------------ reading */
export type MonthMemory = { month: string; summary: string; mood?: string; themes?: string[]; liked?: string[]; complaints?: string[];
  requests?: string[]; notable_videos?: string[]; changes?: string; stats?: { comments: number; people: number; mood: number | null } };
export type CreatorProfile = { one_line?: string; creator?: string; audience?: string; strengths?: string[]; weaknesses?: string[];
  recurring_requests?: string[]; recurring_complaints?: string[]; evolution?: string; key_moments?: { month: string; what: string }[];
  opportunities?: string[]; months?: number; created_at?: string };

export async function creatorMemory(channelId: string): Promise<{ profile: CreatorProfile | null; months: MonthMemory[] }> {
  const db = sql();
  const [p] = await db`select data, created_at from insights where scope = 'profile' and target_id = ${channelId} order by created_at desc limit 1`;
  const months = await db`select distinct on (target_id) target_id, data from insights
    where scope = 'month' and target_id like ${`${channelId}:%`} order by target_id desc, created_at desc`;
  return {
    profile: p ? { ...(parse(p.data) as CreatorProfile), created_at: p.created_at as string } : null,
    months: months.map((m) => ({ ...(parse(m.data) as MonthMemory), month: String(m.target_id).split(":")[1] })),
  };
}

/** Compact memory text for Ask AI (profile + recent months, or every channel's one-liner). */
export async function memoryContext(channelId: string | null, maxMonths = 12): Promise<string> {
  if (channelId) {
    const { profile, months } = await creatorMemory(channelId);
    if (!profile && !months.length) return "";
    const parts = [];
    if (profile) parts.push(`Creator profile: ${profile.one_line ?? ""} ${profile.audience ?? ""} Evolution: ${profile.evolution ?? ""}`.slice(0, 1500));
    for (const m of months.slice(0, maxMonths)) parts.push(`[${m.month}] ${String(m.summary ?? "").slice(0, 400)} Changes: ${String(m.changes ?? "").slice(0, 160)}`);
    return parts.join("\n");
  }
  const rows = await sql()`select distinct on (i.target_id) c.title, i.data from insights i join channels c on c.id = i.target_id
    where i.scope = 'profile' order by i.target_id, i.created_at desc`;
  return rows.map((r) => `${r.title}: ${String(parse(r.data).one_line ?? "")}`).join("\n");
}
