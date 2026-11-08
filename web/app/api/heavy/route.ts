import { after, NextResponse, type NextRequest } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { warmHeavy } from "@/lib/panels";

/**
 * Heavy-work run: GET ?key=CRON_SECRET. Started by the 2-minute engine about every 10 minutes (it
 * doesn't wait for it). Works out the heavy sections of big channels for up to ~4 minutes, one at a
 * time, so no page ever has to wait for them. Only one run at a time.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Wrong or missing key" }, { status: 401 });
  const budget = Number(process.env.HEAVY_SECONDS ?? 240) * 1000;
  // Answer at once and work after the reply (the engine doesn't wait); ?wait=1 waits for the result (tests, manual runs).
  if (req.nextUrl.searchParams.get("wait") === "1") return NextResponse.json(await warmHeavy(Date.now() + budget));
  after(() => warmHeavy(Date.now() + budget).then((r) => console.log("[heavy] done", r.done.length, r.skipped ?? "")));
  return NextResponse.json({ started: true });
}
