import { NextResponse, type NextRequest } from "next/server";
import { readPush, verifyRequest } from "@/lib/uploads";
import { ingestVideoIds } from "@/lib/live";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** YouTube's push hub confirms a subscription (GET) or announces a new upload (POST). */
export async function GET(request: NextRequest) {
  const challenge = await verifyRequest(request.nextUrl.searchParams).catch(() => null);
  if (!challenge) return new NextResponse("not subscribed", { status: 404 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  const body = (await request.text()).slice(0, 200_000);
  const push = await readPush(body, request.headers.get("x-hub-signature-256") ? `sha256=${request.headers.get("x-hub-signature-256")!.replace(/^sha256=/, "")}`
    : request.headers.get("x-hub-signature"), request.nextUrl.searchParams.get("key")).catch(() => null);
  if (!push) return new NextResponse("bad signature", { status: 403 });
  // Always answer 2xx for a valid push, even when there's nothing to do (or the hub retries).
  if (push.ids.length) {
    const [c] = await sql()`select 1 from channels where id = ${push.channelId} and active and platform is null`;
    if (c) await ingestVideoIds(push.channelId, push.ids).catch((e) => console.log("[websub]", e instanceof Error ? e.message : e));
  }
  return new NextResponse(null, { status: 204 });
}
