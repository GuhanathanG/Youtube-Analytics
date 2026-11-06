import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "./db";

/**
 * 10. Read-only share links. A random 128-bit token in the URL opens one channel's report without
 * the password. Links can expire and can be revoked on the Manage page.
 */
let ready = false;
async function ensureTable() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists share_links (
    token text primary key, channel_id text not null references channels(id) on delete cascade,
    created_at timestamp not null default (now() at time zone 'utc'), expires_at timestamp, revoked boolean not null default false,
    views integer not null default 0)`;
  await db`alter table share_links enable row level security`;
  ready = true;
}

export type ShareLink = { token: string; channel_id: string; channel_title: string; created_at: string; expires_at: string | null; revoked: boolean; views: number };

export async function createShareLink(channelId: string, days: number | null): Promise<string> {
  await ensureTable();
  const token = randomBytes(16).toString("base64url");
  const expires = days ? new Date(Date.now() + days * 86400_000).toISOString().slice(0, 19).replace("T", " ") : null;
  await sql()`insert into share_links (token, channel_id, expires_at) values (${token}, ${channelId}, ${expires})`;
  return token;
}

export async function revokeShareLink(token: string) {
  await ensureTable();
  await sql()`update share_links set revoked = true where token = ${token}`;
}

export async function listShareLinks(): Promise<ShareLink[]> {
  await ensureTable();
  return (await sql()`select s.token, s.channel_id, c.title as channel_title, s.created_at, s.expires_at, s.revoked, s.views
    from share_links s join channels c on c.id = s.channel_id order by s.created_at desc limit 30`) as unknown as ShareLink[];
}

/** The channel a valid (not revoked, not expired) token opens, or null. Counts the view. */
export async function resolveShareLink(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  await ensureTable();
  const [r] = await sql()`update share_links set views = views + 1
    where token = ${token} and not revoked and (expires_at is null or expires_at > (now() at time zone 'utc'))
    returning channel_id`;
  return (r?.channel_id as string) ?? null;
}
