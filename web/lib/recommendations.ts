import "server-only";
import { sql } from "./db";
import { within } from "./cache";
import { stored } from "./stored";
import { chatJson } from "./ai";
import { latestInsight } from "./queries";
import { channelAnalytics } from "./analytics";
import { channelHealth, unansweredQuestions } from "./creator-insights";
import { panel } from "./panels";
import { buildMoves, type Move } from "./moves";
import { radar } from "./radar";

/**
 * Command Center data: the channel's next moves (rule-based, from everything the platform already
 * knows) plus a short AI-written daily brief on top. Inputs come from saved panel results, so this is
 * quick; each source gives up after a few seconds rather than holding up the page.
 */
export type Command = { moves: Move[]; health: { score: number | null; grade: string; parts: { key: string; label: string; score: number; detail: string }[] } | null;
  brief: { headline?: string; brief?: string; focus?: string } | null };

async function uploadRhythm(channelId: string): Promise<{ last: number | null; gap: number | null }> {
  const rows = await sql()`select published_at from videos where channel_id = ${channelId} and published_at is not null
    order by published_at desc limit 12`;
  const t = rows.map((r) => new Date(String(r.published_at).replace(" ", "T") + "Z").getTime());
  if (!t.length) return { last: null, gap: null };
  const gaps = t.slice(1).map((v, k) => (t[k] - v) / 86400000).sort((a, b) => a - b);
  return { last: (Date.now() - t[0]) / 86400000, gap: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null };
}

export async function nextMoves(channelId: string): Promise<{ moves: Move[]; health: Command["health"] }> {
  const empty = { top: [], superfans: [], critics: [] };
  const [a, health, questions, ideas, trend, people, preds, rhythm] = await Promise.all([
    within(channelAnalytics(channelId), 12_000, null), within(channelHealth(channelId), 12_000, null),
    within(unansweredQuestions(channelId, 20), 8000, []), within(latestInsight("ideas", channelId), 5000, null),
    within(panel("trend", channelId), 8000, { months: [], series: [], rising: [] }), within(panel("people", channelId), 8000, empty),
    within(panel("preds", channelId), 8000, []), within(uploadRhythm(channelId), 5000, { last: null, gap: null }),
  ]);
  const rivals = await within(radar(channelId), 8000, null);
  const moves = buildMoves({
    channelId, questions,
    ideas: ((ideas?.data as { ideas?: unknown[] } | undefined)?.ideas ?? []) as { title?: string; why?: string; requests?: number; likes?: number }[],
    heatmapBest: a?.heatmap.best ?? null, titleFeatures: a?.titleFeatures ?? [], lengths: a?.lengths ?? [],
    formats: a?.formats ?? null, topVideos: a?.top ?? [], rising: trend.rising, healthParts: health?.parts ?? [],
    superfans: people.superfans, critics: people.critics,
    predictions: preds.map((p) => ({ video_id: p.video_id, title: p.title, age_hours: p.age_hours, index: p.index })),
    lastUploadDays: rhythm.last, typicalGapDays: rhythm.gap,
    platform: channelId.startsWith("ig_") ? "instagram" : "youtube",
    rivalBreakouts: (rivals?.breakouts ?? []).map((b) => ({ channel: b.channel, id: b.id, title: b.title, outlier: b.outlier })),
  });
  return { moves, health: health ? { score: health.score, grade: health.grade, parts: health.parts } : null };
}

/** One AI request per channel every 6 hours: a headline and a 2–3 sentence brief over the moves. */
export function dailyBrief(channelId: string, title: string, moves: Move[], health: Command["health"]): Promise<Command["brief"]> {
  const hours = Number(process.env.BRIEF_EVERY_HOURS ?? 6);
  const slot = Math.floor(Date.now() / (hours * 3600_000));
  return stored(`brief:${channelId}:${slot}`, hours * 3600_000, async () => {
    if (!moves.length) return null;
    const out = await chatJson(
      `You are a sharp YouTube growth strategist writing a daily brief for a creator's dashboard. Be specific, warm and
direct; no fluff, no emojis, no markdown. Use only the facts given. Reply with JSON only:
{"headline": "max 9 words, the single most important thing today", "brief": "2-3 sentences: what's happening and what to do first",
 "focus": "one of: audience, content, packaging, timing, growth, community, fix"}`,
      `Channel: ${title}\nHealth: ${health?.score ?? "unknown"}/100 (${health?.grade ?? "-"})\nNext moves (ranked):\n${moves.map((m, k) =>
        `${k + 1}. ${m.title} — ${m.why} [${m.evidence.join("; ")}]`).join("\n")}`,
      600, Date.now() + 20_000);
    if (!out) throw new Error("no AI answer right now"); // not saved, so the next visit tries again
    return out.data as Command["brief"];
  });
}
