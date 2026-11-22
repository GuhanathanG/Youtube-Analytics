import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Live training progress for the Model Lab (signed-in only: /api is behind the site login). */
export async function GET() {
  try {
    const rows = await sql()`select job, run_id, phase, step, total, loss, history, note, started_at, updated_at,
      extract(epoch from ((now() at time zone 'utc') - updated_at))::int as quiet_s,
      extract(epoch from (updated_at - started_at))::int as elapsed_s
      from training_progress order by updated_at desc`;
    return NextResponse.json({ jobs: rows.map((r) => ({ ...r, history: (() => { try { return JSON.parse(String(r.history ?? "[]")); } catch { return []; } })() })) },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ jobs: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
