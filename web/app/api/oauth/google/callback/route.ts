import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn, pullReport, redirectUri } from "@/lib/owner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Google sends the owner back here; check the state value, store the key, pull the first report. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/manage?${q}`, request.url));
    res.cookies.delete({ name: "cp_oauth_state", path: "/api/oauth" });
    return res;
  };
  const state = p.get("state") ?? "", expected = request.cookies.get("cp_oauth_state")?.value ?? "";
  if (!state || !expected || state.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    return back("connect_error=" + encodeURIComponent("The sign-in expired or didn't start here. Press Connect again."));
  }
  if (p.get("error")) return back("connect_error=" + encodeURIComponent(`Google: ${p.get("error")}`));
  try {
    const { channelId, title } = await completeSignIn(p.get("code") ?? "", redirectUri(request.nextUrl.origin));
    await pullReport(channelId).catch(() => null); // first numbers right away; the engine refreshes them every few hours
    return back("connected=" + encodeURIComponent(title));
  } catch (e) {
    return back("connect_error=" + encodeURIComponent(e instanceof Error ? e.message.slice(0, 200) : "failed"));
  }
}
