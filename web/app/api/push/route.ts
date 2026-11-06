import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { removeSubscription, saveSubscription, sendPush, vapidKeys } from "@/lib/push";

/** Phone notifications: GET public key · POST {subscription} or {test: true} · DELETE {endpoint}. Signed-in users only. */
export const dynamic = "force-dynamic";

async function signedIn() {
  const store = await cookies();
  return isValidSession(store.get(SESSION_COOKIE)?.value);
}

export async function GET() {
  if (!(await signedIn())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ publicKey: (await vapidKeys()).publicKey });
}

export async function POST(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body?.test) {
    const n = await sendPush("✅ Creator Pulse notifications are on", "Alerts and the weekly report will appear here.", "/manage", "test");
    return NextResponse.json({ sent: n });
  }
  try {
    await saveSubscription(body?.subscription ?? {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({}));
  if (typeof endpoint === "string") await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
