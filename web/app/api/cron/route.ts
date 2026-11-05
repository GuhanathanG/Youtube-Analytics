import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { liveTick } from "@/lib/live";

/**
 * The 24/7 engine. An external timer (cron-job.org, free) calls this every 2 minutes,
 * and Vercel's own daily cron calls it as a backup, so data and AI keep flowing even
 * when nobody has the website open. Protected by CRON_SECRET:
 *   https://<site>/api/cron?key=<CRON_SECRET>      (or header  Authorization: Bearer <CRON_SECRET>)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set in Vercel" }, { status: 503 });
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Wrong or missing key" }, { status: 401 });
  try {
    return NextResponse.json(await liveTick("cron"));
  } catch (e) {
    return NextResponse.json({ status: "error", message: e instanceof Error ? e.message.slice(0, 300) : "error" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
