import "server-only";
import webpush from "web-push";
import { sql, ensureRls } from "./db";

/**
 * Phone notifications (web push) for alerts. The signing keys (VAPID) are created automatically
 * the first time and kept in the database, so there is nothing to set up. Set VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY in Vercel only if you want to manage them yourself.
 */
let ready = false;
async function ensureTables() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists push_subscriptions (endpoint text primary key, p256dh text not null, auth text not null,
    created_at timestamp not null default (now() at time zone 'utc'))`;
  await db`create table if not exists app_secrets (name text primary key, value text not null)`;
  await ensureRls("push_subscriptions");
  await ensureRls("app_secrets");
  ready = true;
}

let keys: { publicKey: string; privateKey: string } | null = null;
export async function vapidKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return (keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY });
  }
  await ensureTables();
  const db = sql();
  const rows = await db`select name, value from app_secrets where name in ('vapid_public', 'vapid_private')`;
  const got = Object.fromEntries(rows.map((r) => [r.name as string, r.value as string]));
  if (got.vapid_public && got.vapid_private) return (keys = { publicKey: got.vapid_public, privateKey: got.vapid_private });
  const fresh = webpush.generateVAPIDKeys();
  // "do nothing" on conflict: if two servers race, both then read the one that was stored first.
  await db`insert into app_secrets (name, value) values ('vapid_public', ${fresh.publicKey}), ('vapid_private', ${fresh.privateKey})
    on conflict (name) do nothing`;
  keys = null;
  return vapidKeys();
}

export async function saveSubscription(sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
  const scheme = process.env.PUSH_ALLOW_HTTP === "1" ? /^https?:\/\// : /^https:\/\//; // plain http only in tests
  if (!sub.endpoint || !scheme.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("Invalid subscription");
  await ensureTables();
  await sql()`insert into push_subscriptions (endpoint, p256dh, auth) values (${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth})
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth`;
}

export async function removeSubscription(endpoint: string) {
  await ensureTables();
  await sql()`delete from push_subscriptions where endpoint = ${endpoint}`;
}

export async function pushCount(): Promise<number> {
  try { await ensureTables(); const [r] = await sql()`select count(*)::int as n from push_subscriptions`; return r.n as number; } catch { return 0; }
}

/** Send a notification to every subscribed phone/browser. Dead subscriptions are removed. */
export async function sendPush(title: string, body: string, url = "/", tag?: string): Promise<number> {
  await ensureTables();
  const subs = await sql()`select endpoint, p256dh, auth from push_subscriptions`;
  if (!subs.length) return 0;
  const k = await vapidKeys();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:alerts@creator-pulse.invalid", k.publicKey, k.privateKey);
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      // web-push encrypts and signs the message; we send it with fetch.
      const r = webpush.generateRequestDetails({ endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
        JSON.stringify({ title, body: body.slice(0, 300), url, tag }), { TTL: 3600 });
      const res = await fetch(r.endpoint, { method: r.method, headers: r.headers as Record<string, string>, body: r.body as unknown as BodyInit,
        signal: AbortSignal.timeout(8000) });
      if (res.ok) ok++;
      else if (res.status === 404 || res.status === 410) await removeSubscription(s.endpoint as string); // phone unsubscribed
    } catch { /* network problem: try again with the next alert */ }
  }));
  return ok;
}
