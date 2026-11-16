import "server-only";
import { sql, ensureRls } from "./db";
import { findSocialLinks, type SocialLink } from "./social-links";

/**
 * A YouTube channel's linked social accounts: found in its description, tracked with one click (Instagram),
 * and remembered as a pair so YouTube vs Instagram opens on the right accounts.
 */
let ready: Promise<void> | null = null;
function ensureTable() {
  ready ??= (async () => {
    await sql()`create table if not exists channel_links (youtube_id text not null, other_id text not null,
      created_at timestamp not null default (now() at time zone 'utc'), primary key (youtube_id, other_id))`;
    await ensureRls("channel_links");
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export type LinkedAccount = SocialLink & { trackedId: string | null; linked: boolean };

export async function linkedAccounts(channelId: string): Promise<LinkedAccount[]> {
  await ensureTable();
  const db = sql();
  const [ch] = await db`select description from channels where id = ${channelId}`;
  const found = findSocialLinks(ch?.description as string | null);
  const ig = found.filter((l) => l.platform === "instagram").map((l) => `ig_${l.handle}`);
  const [tracked, links] = await Promise.all([
    ig.length ? db`select id from channels where id in ${db(ig)}` : Promise.resolve([]),
    db`select other_id from channel_links where youtube_id = ${channelId}`,
  ]);
  const t = new Set(tracked.map((r) => r.id as string)), l = new Set(links.map((r) => r.other_id as string));
  return found.map((f) => {
    const id = f.platform === "instagram" ? `ig_${f.handle}` : null;
    return { ...f, trackedId: id && t.has(id) ? id : null, linked: !!id && l.has(id) };
  });
}

export async function linkAccounts(youtubeId: string, otherId: string) {
  await ensureTable();
  await sql()`insert into channel_links (youtube_id, other_id) values (${youtubeId}, ${otherId}) on conflict do nothing`;
}

/** The Instagram account paired with a YouTube channel (first linked), if any. */
export async function linkedInstagram(youtubeId: string): Promise<string | null> {
  await ensureTable();
  const [r] = await sql()`select l.other_id from channel_links l join channels c on c.id = l.other_id
    where l.youtube_id = ${youtubeId} and c.active order by l.created_at limit 1`;
  return (r?.other_id as string) ?? null;
}
