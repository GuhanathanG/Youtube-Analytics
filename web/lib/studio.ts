import "server-only";
import { sql, ensureRls, ensureIndex } from "./db";
import { within } from "./cache";
import { chatJson } from "./ai";
import { channelAnalytics } from "./analytics";
import { unansweredQuestions } from "./creator-insights";
import { latestInsight } from "./queries";
import { memoryContext } from "./memory";
import { summaries } from "./summary";
import { demandWords, scoreTitle, type TitleContext, type TitleScore } from "./packaging";

/**
 * Content Studio: from a topic to a ready-to-shoot plan (angles, titles, thumbnail, hook, outline, tags),
 * grounded in this channel's own data. Packaging Lab: score titles against the channel's winners.
 */
export type StudioDraft = {
  id: number; channel_id: string; topic: string; created_at: string; model: string | null;
  data: {
    angles?: { name: string; pitch: string }[]; titles?: TitleScore[];
    thumbnail?: { concept?: string; text?: string; emotion?: string; colors?: string[] };
    hook?: string; outline?: { part: string; notes: string }[]; tags?: string[]; cta?: string; why?: string;
  };
};

let ready = false;
async function ensureTable() {
  if (ready) return;
  await sql()`create table if not exists studio_drafts (id serial primary key, channel_id text not null, topic text not null,
    data text not null, model text, created_at timestamp not null default (now() at time zone 'utc'))`;
  await ensureIndex("ix_studio_drafts_channel", "create index if not exists ix_studio_drafts_channel on studio_drafts (channel_id, created_at desc)");
  await ensureRls("studio_drafts");
  ready = true;
}

/** What has worked on this channel and what its audience asks for (for scoring titles). */
export async function titleContext(channelId: string): Promise<TitleContext & { topTitles: { title: string; outlier: number | null }[]; ideas: string[] }> {
  const [a, questions, ideas] = await Promise.all([
    within(channelAnalytics(channelId), 12_000, null), within(unansweredQuestions(channelId, 40), 8000, []),
    within(latestInsight("ideas", channelId), 5000, null),
  ]);
  const ideaList = ((ideas?.data as { ideas?: { title?: string; examples?: string[] }[] } | undefined)?.ideas ?? []);
  const texts = [...questions.map((q) => q.translation || q.text), ...ideaList.flatMap((i) => [i.title ?? "", ...(i.examples ?? [])])];
  return {
    features: a?.titleFeatures ?? [], words: a?.titleWords ?? [], demand: demandWords(texts),
    topTitles: (a?.top ?? []).slice(0, 8).map((v) => ({ title: v.title, outlier: v.outlier })),
    ideas: ideaList.map((i) => i.title ?? "").filter(Boolean).slice(0, 8),
  };
}

export async function scoreTitles(channelId: string, titles: string[]): Promise<TitleScore[]> {
  const ctx = await titleContext(channelId);
  return titles.map((t) => t.trim()).filter(Boolean).slice(0, 10).map((t) => scoreTitle(t, ctx)).sort((a, b) => b.score - a.score);
}

const SYSTEM = `You are a top YouTube strategist and scriptwriter helping a creator plan their next video. Ground every
suggestion in the channel data provided (their breakout titles, what viewers ask for, their audience and language mix).
Match the creator's language style (e.g. Tamil/English mix if that is how they title). No clickbait that the video can't
deliver. Reply with JSON only:
{"angles": [{"name": "short label", "pitch": "one sentence"}] (3 items),
 "titles": ["6 title options, under 70 characters, varied styles"],
 "thumbnail": {"concept": "what is in the frame", "text": "max 4 words on the image", "emotion": "face/emotion", "colors": ["2-3 colors"]},
 "hook": "first 15 seconds, spoken words",
 "outline": [{"part": "section name", "notes": "what to cover"}] (5-8 items),
 "tags": ["8-12 search tags"], "cta": "end-screen call to action", "why": "1-2 sentences on why this will work for this audience"}`;

export async function generateDraft(channelId: string, title: string, topic: string): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  await ensureTable();
  const [ctx, memory, sums] = await Promise.all([titleContext(channelId), within(memoryContext(channelId, 6), 6000, ""), within(summaries(), 5000, new Map())]);
  const langs = (sums.get(channelId)?.languages ?? []).slice(0, 4).map((l: { code: string; comments: number }) => `${l.code} (${l.comments})`).join(", ");
  const user = `Channel: ${title}
Topic idea: ${topic}
Breakout titles on this channel (views vs usual): ${ctx.topTitles.map((t) => `"${t.title}" ${t.outlier ? t.outlier.toFixed(1) + "×" : ""}`).join("; ") || "none yet"}
Title patterns that work here: ${ctx.features.filter((f) => (f.lift ?? 0) >= 1.2 && f.with >= 3).map((f) => `${f.label} ${f.lift!.toFixed(1)}×`).join(", ") || "not enough data"}
Viewers keep asking about: ${ctx.demand.join(", ") || "-"}
Requested video ideas: ${ctx.ideas.join("; ") || "-"}
Comment languages: ${langs || "-"}
What the AI remembers about this creator: ${memory.slice(0, 2500) || "-"}`;
  const out = await chatJson(SYSTEM, user, 2500, Date.now() + 40_000);
  if (!out) return { ok: false, message: "The free AI models are busy right now. Try again in a minute." };
  const d = out.data as Record<string, unknown>;
  const titles = (Array.isArray(d.titles) ? d.titles : []).map((t) => String(t)).filter(Boolean);
  const data = { ...d, titles: titles.map((t) => scoreTitle(t, ctx)).sort((a, b) => b.score - a.score) };
  const [row] = await sql()`insert into studio_drafts (channel_id, topic, data, model) values (${channelId}, ${topic.slice(0, 300)}, ${JSON.stringify(data)}, ${out.model})
    returning id`;
  return { ok: true, id: Number(row.id) };
}

export async function rewriteTitles(channelId: string, title: string, draft: string): Promise<TitleScore[]> {
  const ctx = await titleContext(channelId);
  const out = await chatJson(`You improve YouTube titles. Keep the meaning and the creator's language style; under 70 characters;
use the patterns and words that work on this channel. Reply with JSON only: {"titles": ["5 improved titles"]}`,
    `Channel: ${title}\nDraft title: ${draft}\nPatterns that work here: ${ctx.features.filter((f) => (f.lift ?? 0) >= 1.2 && f.with >= 3).map((f) => f.label).join(", ") || "-"}
Proven words: ${ctx.words.filter((w) => w.outlier >= 1.5 && w.count >= 2).slice(0, 10).map((w) => w.word).join(", ") || "-"}
Viewers ask about: ${ctx.demand.join(", ") || "-"}\nBreakout titles: ${ctx.topTitles.slice(0, 5).map((t) => t.title).join(" | ") || "-"}`,
    800, Date.now() + 25_000);
  const titles = ((out?.data as { titles?: unknown[] } | undefined)?.titles ?? []).map(String).filter(Boolean);
  return titles.map((t) => scoreTitle(t, ctx)).sort((a, b) => b.score - a.score);
}

export async function listDrafts(channelId: string, limit = 12): Promise<{ id: number; topic: string; created_at: string }[]> {
  await ensureTable();
  return (await sql()`select id, topic, created_at from studio_drafts where channel_id = ${channelId} order by created_at desc limit ${limit}`) as never;
}

export async function getDraft(id: number): Promise<StudioDraft | null> {
  await ensureTable();
  const [r] = await sql()`select id, channel_id, topic, data, model, created_at from studio_drafts where id = ${id}`;
  if (!r) return null;
  let data = {};
  try { data = JSON.parse(r.data as string); } catch { /* ignore */ }
  return { ...(r as unknown as StudioDraft), data };
}
