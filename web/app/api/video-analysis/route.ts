import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { cronAuthorised } from "@/lib/cron-auth";
import { analyseDueVideos, analyseVideo } from "@/lib/video";

/**
 * AI video analysis (Gemini watches the video; can take 1–3 minutes).
 *  - GET ?key=CRON_SECRET  → analyse the newest not-yet-analysed video (call every 2 hours from cron-job.org)
 *  - POST {videoId}        → analyse one video now (signed-in users; the button on the video page)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Wrong or missing key" }, { status: 401 });
  return NextResponse.json(await analyseDueVideos(1));
}

export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { videoId } = await req.json().catch(() => ({}));
  if (!videoId || typeof videoId !== "string") return NextResponse.json({ error: "videoId required" }, { status: 400 });
  return NextResponse.json(await analyseVideo(videoId));
}
