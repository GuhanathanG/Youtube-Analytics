import { NextResponse } from "next/server";
import { liveTick } from "@/lib/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    return NextResponse.json(await liveTick());
  } catch (e) {
    return NextResponse.json({ status: "error", message: e instanceof Error ? e.message.slice(0, 300) : "error",
      newComments: 0, newVideos: 0, labelled: 0, at: new Date().toISOString() }, { status: 200 });
  }
}
