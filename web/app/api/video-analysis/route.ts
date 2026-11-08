import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { cronAuthorised } from "@/lib/cron-auth";
import { analyseDueVideos, analyseVideo } from "@/lib/video";
import { analyseDueThumbnails } from "@/lib/thumbnails";

/**
 * AI video analysis (Gemini watches the video; can take 1–3 minutes).
 *  - GET ?key=CRON_SECRET  → analyse the newest not-yet-analysed videos/reels (as many as fit in ~2.5 min), then thumbnails
 *                           (call every 2 hours from cron-job.org)
 *  - POST {videoId}        → analyse one video now (signed-in users; the button on the video page)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "Wrong or missing key" }, { status: 401 });
  const started = Date.now();
  // Several videos per call while time allows (each takes ~10-60 s); stop starting new ones after ~2.5 minutes.
  const video = await analyseDueVideos(Number(process.env.VIDEO_AI_PER_CALL ?? 8), started + 150_000);
  // Thumbnails are small and quick: use the rest of the time (leave a minute of margin).
  const thumbnails = await analyseDueThumbnails(25, started + (maxDuration - 60) * 1000).catch(() => 0);
  return NextResponse.json({ ...video, thumbnails });
}

export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { videoId } = await req.json().catch(() => ({}));
  if (!videoId || typeof videoId !== "string") return NextResponse.json({ error: "videoId required" }, { status: 400 });
  return NextResponse.json(await analyseVideo(videoId));
}
