import "server-only";
import { sql, ensureRls, ensureColumns, ensureIndex } from "./db";
import { chatJson } from "./ai";
import { quickLabel } from "./quick-labels";
import { liveChatPage, YouTubeError, type VideoItem } from "./youtube";

/**
 * 1. Live chat. While a watched creator is live (stream or premiere), the 2-minute engine reads
 * the chat (5 YouTube units per read) and stores every message: text, author, Super Chats, a quick
 * mood label and whether it's a question. YouTube has no chat replay in its API, so chat is only
 * captured while the stream is live. After the stream, the AI writes a short summary.
 */
let ready = false;
export async function ensureLiveChat() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists live_chat (
    id text primary key, video_id text not null references videos(id) on delete cascade, published_at timestamp,
    author_name text, author_channel_id text, text text not null default '', kind text, amount_micros bigint, currency text,
    sentiment text, is_question boolean, is_member boolean)`;
  await ensureIndex("ix_live_chat_video", "create index if not exists ix_live_chat_video on live_chat (video_id, published_at)");
  await ensureRls("live_chat");
  await ensureColumns("videos", [["live_status", "text"], ["live_chat_id", "text"], ["live_chat_token", "text"],
    ["live_started_at", "timestamp"], ["live_ended_at", "timestamp"], ["live_viewers", "integer"], ["live_chat_error", "text"]]);
  ready = true;
}

const ts = (s?: string) => (s ? s.replace("T", " ").replace(/\.\d+Z?$|Z$/, "").slice(0, 19) : null);

/** Remember live status and chat id from videos.list (called after videos are saved). */
export async function saveLiveInfo(items: VideoItem[]) {
  const live = items.filter((v) => v.liveStreamingDetails || (v.snippet?.liveBroadcastContent && v.snippet.liveBroadcastContent !== "none"));
  if (!live.length) return;
  await ensureLiveChat();
  const db = sql();
  for (const v of live) {
    const d = v.liveStreamingDetails ?? {};
    const status = d.actualEndTime ? "ended" : v.snippet?.liveBroadcastContent === "live" || (d.actualStartTime && !d.actualEndTime) ? "live"
      : v.snippet?.liveBroadcastContent === "upcoming" ? "upcoming" : "ended";
    await db`update videos set live_status = ${status}, live_chat_id = coalesce(${d.activeLiveChatId ?? null}, live_chat_id),
      live_started_at = coalesce(${ts(d.actualStartTime)}::timestamp, live_started_at),
      live_ended_at = coalesce(${ts(d.actualEndTime)}::timestamp, live_ended_at),
      live_viewers = coalesce(${d.concurrentViewers ? Number(d.concurrentViewers) : null}::int, live_viewers)
      where id = ${v.id}`;
  }
}

const QUESTION = /\?|^\s*(what|why|how|when|where|which|who|can you|could you|do you|is it|enna|eppo|eppadi|epdi|yen|enga|kya|kyu|kyun|kaise|kab|kaha|kahan|kaun)\b/i;

/** Read new chat messages for streams that are live now. Returns how many were saved. */
export async function pollLiveChats(timeLeft: () => boolean): Promise<number> {
  await ensureLiveChat();
  const db = sql();
  const live = await db`select v.id, v.live_chat_id, v.live_chat_token from videos v join channels c on c.id = v.channel_id
    where c.active and v.live_status = 'live' and v.live_chat_id is not null and v.live_chat_error is null
    order by v.live_started_at desc nulls last limit 3`;
  let saved = 0;
  for (const v of live) {
    let token = (v.live_chat_token as string | null) ?? undefined;
    for (let page = 0; page < 3 && timeLeft(); page++) {
      let data;
      try {
        data = await liveChatPage(v.live_chat_id as string, token);
      } catch (e) {
        if (e instanceof YouTubeError && (e.reason === "liveChatEnded" || e.status === 404)) {
          await db`update videos set live_status = 'ended', live_ended_at = coalesce(live_ended_at, (now() at time zone 'utc')) where id = ${v.id}`;
        } else if (e instanceof YouTubeError && (e.status === 403 || e.status === 401)) {
          await db`update videos set live_chat_error = ${`${e.reason}: ${e.message}`.slice(0, 300)} where id = ${v.id}`;
        } else throw e;
        break;
      }
      const rows = (data.items ?? []).map((m) => {
        const s = m.snippet ?? {}, a = m.authorDetails ?? {};
        const text = s.displayMessage ?? s.textMessageDetails?.messageText ?? s.superChatDetails?.userComment ?? "";
        const q = quickLabel(text);
        return {
          id: m.id, video_id: v.id as string, published_at: ts(s.publishedAt), author_name: a.displayName ?? null,
          author_channel_id: a.channelId ?? s.authorChannelId ?? null, text: text.slice(0, 2000), kind: s.type ?? null,
          amount_micros: s.superChatDetails?.amountMicros ? Number(s.superChatDetails.amountMicros) : s.superStickerDetails?.amountMicros ? Number(s.superStickerDetails.amountMicros) : null,
          currency: s.superChatDetails?.currency ?? s.superStickerDetails?.currency ?? null,
          sentiment: q?.sentiment ?? null, is_question: QUESTION.test(text), is_member: a.isChatSponsor ?? null,
        };
      }).filter((r) => r.id);
      if (rows.length) {
        const res = await db`insert into live_chat ${db(rows)} on conflict (id) do nothing returning id`;
        saved += res.length;
      }
      token = data.nextPageToken ?? token;
      await db`update videos set live_chat_token = ${token ?? null} where id = ${v.id}`;
      if (data.offlineAt) {
        await db`update videos set live_status = 'ended', live_ended_at = ${ts(data.offlineAt)} where id = ${v.id}`;
        break;
      }
      if (!rows.length) break; // nothing new right now
    }
  }
  return saved;
}

/** After a stream ends, one AI request summarises its chat (stored as an insight, scope "livechat"). */
export async function summariseEndedChats(deadline: number): Promise<number> {
  await ensureLiveChat();
  const db = sql();
  const due = await db`select v.id, v.title from videos v
    where v.live_status = 'ended' and (select count(*) from live_chat m where m.video_id = v.id) >= 30
      and not exists (select 1 from insights i where i.scope = 'livechat' and i.target_id = v.id) limit 1`;
  let n = 0;
  for (const v of due) {
    const msgs = await db`select text, author_name, kind, amount_micros from live_chat where video_id = ${v.id}
      and length(text) > 3 order by (amount_micros is not null) desc, random() limit 300`;
    const out = await chatJson(
      `You summarise a YouTube live stream's chat for a creator-analytics dashboard. Messages can be in any language,
including Tanglish/Hinglish. Reply with JSON only: {"summary": "3-5 sentences on the chat's mood and what viewers talked about",
"highlights": ["up to 5 notable moments or reactions"], "requests": ["up to 5 things viewers asked for"],
"mood": "positive|mixed|negative"}`,
      `Stream: ${v.title}\nChat messages:\n${msgs.map((m) => `- ${m.amount_micros ? "[Super Chat] " : ""}${String(m.text).slice(0, 200)}`).join("\n")}`,
      1500, deadline);
    if (!out) break;
    const [{ count }] = await db`select count(*)::int as count from live_chat where video_id = ${v.id}`;
    await db`insert into insights (scope, target_id, created_at, comment_count, model, data)
      values ('livechat', ${v.id}, (now() at time zone 'utc'), ${count}, ${out.model}, ${JSON.stringify(out.data)})`;
    n++;
  }
  return n;
}

export type LiveChatStats = {
  status: string | null; viewers: number | null; started: string | null; ended: string | null; error: string | null;
  messages: number; chatters: number; questions: number; members: number;
  superChats: { currency: string; total: number; count: number }[];
  perMinute: { minute: string; n: number }[]; peak: { minute: string; n: number } | null;
  mood: { positive: number; neutral: number; negative: number };
  topChatters: { name: string; n: number }[]; recentQuestions: { text: string; author: string | null; at: string }[];
  summary: { summary?: string; highlights?: string[]; requests?: string[]; mood?: string } | null;
};

export async function liveChatStats(videoId: string): Promise<LiveChatStats | null> {
  try {
    await ensureLiveChat();
  } catch { return null; }
  const db = sql();
  const [v] = await db`select live_status, live_viewers, live_started_at, live_ended_at, live_chat_error from videos where id = ${videoId}`;
  if (!v?.live_status) return null;
  const [t] = await db`select count(*)::int as messages, count(distinct author_channel_id)::int as chatters,
      count(*) filter (where is_question)::int as questions, count(*) filter (where is_member)::int as members,
      count(*) filter (where sentiment = 'positive')::int as pos, count(*) filter (where sentiment = 'negative')::int as neg
    from live_chat where video_id = ${videoId}`;
  const supers = await db`select currency, sum(amount_micros)::float8 / 1e6 as total, count(*)::int as count from live_chat
    where video_id = ${videoId} and amount_micros is not null group by currency order by 2 desc`;
  const perMinute = await db`select to_char(date_trunc('minute', published_at), 'HH24:MI') as minute, count(*)::int as n
    from live_chat where video_id = ${videoId} and published_at is not null group by date_trunc('minute', published_at) order by date_trunc('minute', published_at)`;
  const top = await db`select max(author_name) as name, count(*)::int as n from live_chat where video_id = ${videoId}
    group by author_channel_id order by 2 desc limit 8`;
  const qs = await db`select text, author_name, published_at from live_chat where video_id = ${videoId} and is_question
    order by published_at desc limit 8`;
  const [ins] = await db`select data from insights where scope = 'livechat' and target_id = ${videoId} order by created_at desc limit 1`;
  const pm = perMinute.map((r) => ({ minute: r.minute as string, n: r.n as number }));
  return {
    status: v.live_status as string, viewers: (v.live_viewers as number) ?? null, started: (v.live_started_at as string) ?? null,
    ended: (v.live_ended_at as string) ?? null, error: (v.live_chat_error as string) ?? null,
    messages: t.messages as number, chatters: t.chatters as number, questions: t.questions as number, members: t.members as number,
    superChats: supers.map((s) => ({ currency: s.currency as string, total: s.total as number, count: s.count as number })),
    perMinute: pm, peak: pm.length ? pm.reduce((a, b) => (b.n > a.n ? b : a)) : null,
    mood: { positive: t.pos as number, negative: t.neg as number, neutral: (t.messages as number) - (t.pos as number) - (t.neg as number) },
    topChatters: top.map((r) => ({ name: (r.name as string) ?? "Viewer", n: r.n as number })),
    recentQuestions: qs.map((q) => ({ text: q.text as string, author: (q.author_name as string) ?? null, at: q.published_at as string })),
    summary: ins ? (() => { try { return JSON.parse(ins.data as string); } catch { return null; } })() : null,
  };
}

export async function liveNow(): Promise<{ id: string; title: string; channel: string; viewers: number | null; messages: number }[]> {
  try {
    await ensureLiveChat();
    return (await sql()`select v.id, v.title, c.title as channel, v.live_viewers as viewers,
        (select count(*)::int from live_chat m where m.video_id = v.id) as messages
      from videos v join channels c on c.id = v.channel_id where c.active and v.live_status = 'live' order by v.live_started_at desc limit 5`) as never;
  } catch { return []; }
}
