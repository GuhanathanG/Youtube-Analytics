import "server-only";
import { sql } from "./db";
import { aiSlots, chatJson } from "./ai";
import { memoryContext } from "./memory";
import { searchArchive } from "./archive";
import { within } from "./cache";
import { nearestComments } from "./embeddings";

/**
 * 1. Ask AI about your comments.
 *  Step 1: the AI turns the question into search words, in every language/spelling viewers use
 *          (e.g. "audio" -> audio, sound, mic, "sound sariyilla").
 *  Step 2: the best-matching comments (plus the most liked recent ones) are pulled from the database.
 *  Step 3: the AI answers from those comments only, citing them by number.
 */
export type AskAnswer = {
  answer: string;
  citations: { n: number; id: string; text: string; translation: string | null; author: string | null; likes: number;
    sentiment: string | null; video_id: string; video_title: string }[];
  searched: string[];
  model: string;
  timings?: Record<string, number>;
};

const PLAN = `You turn a question about YouTube comments into database search terms.
Viewers write in English, Tamil, Hindi and other languages, in native script AND romanized (Tanglish, Hinglish).
The question may be a follow-up in a conversation: first rewrite it as a complete standalone question using the
conversation so far (e.g. "what about the second one?" -> "What do viewers say about the audio quality?").
Return JSON only: {"standalone": "the complete question", "terms": ["word or short phrase", ...]} with 4-12 terms that
comments answering the question would contain. Include synonyms, common misspellings, and Tamil/Hindi words in both
scripts. Use [] for terms if the question is general (e.g. "summarise the audience mood").`;

const ANSWER = `You are an audience-research analyst. Answer the user's question using ONLY the creator memory (long-term
monthly summaries written earlier from all stored comments), the numbered viewer comments and the statistics provided.
Use the memory for questions about the creator overall or how things changed over time; use comments for evidence.
This is a conversation: use the earlier messages to understand follow-up questions, and don't repeat earlier answers. Be specific and concise (short paragraphs or bullet points, plain English). Quote or
paraphrase real comments and cite them like [3] or [3][7]. If the comments don't answer the question, say so plainly.
Reply with JSON only: {"answer": "markdown text with [n] citations", "used": [n, ...]}`;

export type Turn = { role: "user" | "assistant"; content: string };

/** The last few turns of the conversation, trimmed so the prompt stays small. */
function historyText(history: Turn[]): string {
  return history.slice(-6).map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.replace(/\s+/g, " ").slice(0, 600)}`).join("\n");
}

export async function askComments(question: string, channelId: string | null, history: Turn[] = []): Promise<AskAnswer | { error: string }> {
  if (!aiSlots().length) return { error: "No AI key is set (GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY in Vercel)." };
  const db = sql();
  const deadline = Date.now() + 50000;
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const lap = (k: string) => { timings[k] = Date.now() - t0; };
  const convo = historyText(history);
  const scope = channelId ? db`c.channel_id = ${channelId}` : db`true`;
  const spam = db`(c.is_spam is null or not c.is_spam)`;
  // These don't depend on the AI's search words: start them now, while the AI plans the search.
  const popularP = db`
    select c.id, c.text, c.translation, c.author_name, c.like_count, c.sentiment, c.video_id, v.title as video_title
    from comments c join videos v on v.id = c.video_id
    where ${scope} and ${spam} and c.published_at >= (now() at time zone 'utc') - interval '60 days'
    order by c.like_count desc limit 60`;
  const statsP = db`
    select count(*)::int as n,
      round(100.0 * avg(case when sentiment = 'positive' then 1 else 0 end))::int as pos,
      round(100.0 * avg(case when sentiment = 'negative' then 1 else 0 end))::int as neg
    from comments c where ${scope}`;
  const memoryP = within(memoryContext(channelId).catch(() => ""), 4000, "");
  // Search by meaning (E6): comments closest to the question, whatever words they use. Runs while the AI plans.
  const nearP = within(nearestComments(question, channelId, 60).catch(() => []), 6000, []);

  const plan = await chatJson(PLAN, `${convo ? `Conversation so far:\n${convo}\n\n` : ""}Question: ${question}`, 700, deadline);
  lap("plan");
  const standalone = String(plan?.data.standalone ?? "").trim() || question;
  const terms = ((plan?.data.terms as string[] | undefined) ?? [])
    .map((t) => String(t).trim()).filter((t) => t.length >= 2 && t.length <= 60).slice(0, 12);

  const [matched, fromArchive, popularAll, [stats], memory, near] = await Promise.all([
    terms.length ? db`
      select c.id, c.text, c.translation, c.author_name, c.like_count, c.sentiment, c.video_id, v.title as video_title
      from comments c join videos v on v.id = c.video_id
      where ${scope} and ${spam} and (${terms
        .map((t) => { const like = "%" + t.replace(/[%_]/g, "\\$&") + "%"; return db`(c.text ilike ${like} or c.translation ilike ${like})`; })
        .reduce((acc, f) => db`${acc} or ${f}`)})
      order by c.like_count desc, c.published_at desc limit 90` : Promise.resolve([]),
    // Older comments live in the archive databases (far away, may be asleep): never wait more than 3 s for them.
    terms.length ? within(searchArchive(terms, channelId, 40), 3000, []) : Promise.resolve([]),
    popularP, statsP, memoryP, nearP,
  ]);
  // Close-in-meaning comments (only the clearly related ones), fetched with the same columns as the rest.
  const nearIds = near.filter((n) => n.distance <= Number(process.env.EMBED_MAX_DISTANCE ?? 0.55)).map((n) => n.id);
  const byMeaning = nearIds.length ? await db`
    select c.id, c.text, c.translation, c.author_name, c.like_count, c.sentiment, c.video_id, v.title as video_title
    from comments c join videos v on v.id = c.video_id where c.id in ${db(nearIds)}` : [];
  const rank = new Map(nearIds.map((id, i) => [id, i]));
  byMeaning.sort((a, b) => (rank.get(a.id as string) ?? 0) - (rank.get(b.id as string) ?? 0));
  timings.meaning = byMeaning.length;
  timings.near = near.length;
  lap("search");
  const popular = popularAll.slice(0, matched.length >= 60 ? 20 : 60);
  const seen = new Set<string>();
  // Keyword and meaning matches take turns at the top (both kinds of evidence get in), then archive, then popular.
  const mixed: Record<string, unknown>[] = [];
  for (let i = 0; i < Math.max(matched.length, byMeaning.length); i++) {
    if (matched[i]) mixed.push(matched[i]);
    if (byMeaning[i]) mixed.push(byMeaning[i]);
  }
  const pool = [...mixed, ...fromArchive, ...popular].filter((r) => !seen.has(r.id as string) && seen.add(r.id as string)).slice(0, 120);
  if (!pool.length) return { error: "There are no comments to answer from yet." };

  const lines = pool.map((r, i) => {
    let t = `${i + 1}. (${r.sentiment ?? "?"}, ${r.like_count} likes, on "${String(r.video_title).slice(0, 60)}") ${String(r.text).split(/\s+/).join(" ").slice(0, 280)}`;
    if (r.translation) t += ` [EN: ${String(r.translation).slice(0, 160)}]`;
    return t;
  });
  const prompt = [convo ? `Conversation so far:\n${convo}\n` : "", `Question: ${question}`,
    standalone !== question ? `(Meaning: ${standalone})` : "", `Statistics: ${stats.n} comments in scope, ${stats.pos}% positive, ${stats.neg}% negative.`,
    memory ? `\nCreator memory:\n${memory}\n` : "",
    terms.length ? `Search terms used: ${terms.join(", ")}` : "", "", "Comments:", ...lines].join("\n");
  const out = await chatJson(ANSWER, prompt, 2500, deadline);
  lap("answer");
  console.log(`[ask] plan ${timings.plan} ms, search +${timings.search - timings.plan} ms, answer +${timings.answer - timings.search} ms`);
  if (!out) return { error: "The free AI models are busy or used up right now. Try again in a minute." };
  const answer = String(out.data.answer ?? "").trim();
  const cited = new Set<number>([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  for (const n of (out.data.used as number[] | undefined) ?? []) cited.add(Number(n));
  const citations = [...cited].filter((n) => n >= 1 && n <= pool.length).sort((a, b) => a - b).map((n) => {
    const r = pool[n - 1];
    return { n, id: r.id as string, text: r.text as string, translation: (r.translation as string) ?? null, author: (r.author_name as string) ?? null,
      likes: r.like_count as number, sentiment: (r.sentiment as string) ?? null, video_id: r.video_id as string, video_title: r.video_title as string };
  });
  return { answer, citations, searched: terms, model: out.model, timings };
}
