import { NextResponse, type NextRequest } from "next/server";
import { searchEverything } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  return NextResponse.json(await searchEverything(q));
}
