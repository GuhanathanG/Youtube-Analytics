import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { getThread, listThreads, sendChatMessage } from "@/lib/chat";

/** Conversations API (signed-in only): GET ?t=id → messages, GET → list; POST {threadId?, question, channelId?} → reply. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function signedIn() {
  const store = await cookies();
  return isValidSession(store.get(SESSION_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const t = req.nextUrl.searchParams.get("t");
  if (t) {
    const thread = await getThread(t);
    return thread ? NextResponse.json(thread) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ threads: await listThreads() });
}

export async function POST(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const res = await sendChatMessage(typeof body.threadId === "string" ? body.threadId : null, String(body.question ?? ""),
    typeof body.channelId === "string" && body.channelId ? body.channelId : null);
  return NextResponse.json(res, { status: "error" in res ? 400 : 200 });
}
