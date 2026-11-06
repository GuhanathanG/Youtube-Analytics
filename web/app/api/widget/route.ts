import { NextResponse, type NextRequest } from "next/server";
import { checkWidgetToken, widgetData } from "@/lib/widget";

export const dynamic = "force-dynamic";

/** Read-only numbers for the iPhone widget. Needs the widget key from the Manage page. */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!(await checkWidgetToken(key).catch(() => false))) {
    return NextResponse.json({ error: "Wrong or missing widget key. Copy the script again from the Manage page." }, { status: 401 });
  }
  const c = request.nextUrl.searchParams.get("c");
  const data = await widgetData(c && c.length <= 80 ? c : null);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
