import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authUrl, ownerConfigured, redirectUri } from "@/lib/owner";

export const dynamic = "force-dynamic";

/** Start "Connect your channel": send the (signed-in) owner to Google with a one-time state value. */
export async function GET(request: NextRequest) {
  if (!ownerConfigured()) return NextResponse.redirect(new URL("/manage?connect_error=Add%20GOOGLE_CLIENT_ID%20and%20GOOGLE_CLIENT_SECRET%20in%20Vercel%20first", request.url));
  const state = crypto.randomBytes(18).toString("base64url");
  const res = NextResponse.redirect(authUrl(redirectUri(request.nextUrl.origin), state));
  res.cookies.set("cp_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", maxAge: 600, path: "/api/oauth" });
  return res;
}
