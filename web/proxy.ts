import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";

/** Old copies of the site (their own *.vercel.app addresses) send visitors to the main address, which
 *  always runs the newest code. Old copies run outdated code and can be slow. */
function mainSite(request: NextRequest): URL | null {
  const main = process.env.SITE_HOST ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const host = request.headers.get("host");
  if (process.env.VERCEL_ENV !== "production" || !main || !host || host === main || !host.endsWith(".vercel.app")) return null;
  const url = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${main}`);
  return url;
}

export async function proxy(request: NextRequest) {
  const moved = mainSite(request);
  if (moved) return NextResponse.redirect(moved, 307);
  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, Next.js internals and static files.
  // /api/cron, /api/video-analysis and /api/widget check their own secret key or session (timers and widgets aren't signed-in browsers).
  matcher: ["/((?!login(?:/|$)|api/cron(?:/|$)|api/video-analysis(?:/|$)|api/widget(?:/|$)|api/websub(?:/|$)|share/|manifest\\.webmanifest$|glance\\.webmanifest$|sw\\.js$|offline\\.html$|icons/|_next/static/|_next/image|favicon\\.ico$|icon\\.svg$).*)"],
};
