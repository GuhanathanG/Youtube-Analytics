import { NextResponse, type NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { generateDraft, rewriteTitles, scoreTitles } from "@/lib/studio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Content Studio + Packaging Lab (signed-in only: the proxy refuses /api/* without a session). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { action?: string; channelId?: string; topic?: string; titles?: string[]; title?: string };
  const channelId = String(body.channelId ?? "").slice(0, 80);
  const [c] = await sql()`select title from channels where id = ${channelId}`;
  if (!c) return NextResponse.json({ ok: false, message: "Pick a channel first." }, { status: 400 });
  if (body.action === "plan") {
    const topic = String(body.topic ?? "").trim();
    if (topic.length < 3) return NextResponse.json({ ok: false, message: "Describe the video idea in a few words." }, { status: 400 });
    return NextResponse.json(await generateDraft(channelId, c.title as string, topic.slice(0, 500)));
  }
  if (body.action === "score") return NextResponse.json({ ok: true, scores: await scoreTitles(channelId, (body.titles ?? []).map((t) => String(t).slice(0, 200))) });
  if (body.action === "rewrite") return NextResponse.json({ ok: true, scores: await rewriteTitles(channelId, c.title as string, String(body.title ?? "").slice(0, 200)) });
  return NextResponse.json({ ok: false, message: "Unknown action" }, { status: 400 });
}
