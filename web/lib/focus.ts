import "server-only";
import { cookies } from "next/headers";
import { sql } from "./db";

/**
 * Channel focus: which channel the whole site is about right now (picked in the top bar).
 * Every page (Overview, Comments, Ask AI, Analytics, Ideas) shows only that channel, so channels never
 * mix. "All channels" is a deliberate choice, never the default once there is more than one channel.
 */
export const FOCUS_COOKIE = "cp_focus";

export async function focusChannel(channelIds: string[]): Promise<string | null> {
  const v = (await cookies()).get(FOCUS_COOKIE)?.value;
  if (v === "all") return null;
  if (v && channelIds.includes(v)) return v;
  if (v && v.length <= 80) { // a channel added moments ago may not be in a cached list yet
    const [r] = await sql()`select 1 from channels where id = ${v} and active`.catch(() => []);
    if (r) return v;
  }
  return channelIds[0] ?? null; // default: the first (largest) channel
}
