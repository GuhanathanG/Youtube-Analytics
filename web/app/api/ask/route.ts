import { NextResponse, type NextRequest } from "next/server";
import { askComments } from "@/lib/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST {question, channelId?} → AI answer with cited comments (signed-in users only, via proxy.ts). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (question.length < 3) return NextResponse.json({ error: "Type a question first." }, { status: 400 });
  return NextResponse.json(await askComments(question, body.channelId ? String(body.channelId) : null));
}
