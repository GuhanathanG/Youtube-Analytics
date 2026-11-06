import "server-only";
import { cookies } from "next/headers";
import { sql } from "./db";

/**
 * Channel focus: which of *your* channels the whole site is about right now (picked in the top bar).
 * Every page (Command, Overview, Comments, Ask AI, Analytics, Ideas, Studio) shows only that channel, so
 * channels never mix. "All channels" is a deliberate choice. Competitors are never the focus (see Radar).
 */
export const FOCUS_COOKIE = "cp_focus";

export async function focusChannel(channelIds: string[]): Promise<string | null> {
  const v = (await cookies()).get(FOCUS_COOKIE)?.value;
  if (v === "all") return null;
  const candidates = [...new Set([...(v && v.length <= 80 ? [v] : []), ...channelIds])];
  if (!candidates.length) return null;
  const rows = await sql()`select id from channels where id in ${sql()(candidates)} and active and coalesce(role, '') <> 'competitor'`
    .catch(() => [] as { id: string }[]);
  const ok = new Set(rows.map((r) => r.id as string));
  if (v && ok.has(v)) return v; // a channel added moments ago may not be in a cached list yet
  return channelIds.find((id) => ok.has(id)) ?? null; // default: the first (largest) of your channels
}
