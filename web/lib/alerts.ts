import "server-only";
import { sql } from "./db";

/**
 * 2. Alerts. Checked on every engine run; each alert is sent once (unique key).
 *  - new upload from a watched creator
 *  - negative spike: a recent video's last-6-hours comments are much more negative than the channel's usual
 *  - viral comment: a recent comment with far more likes than the channel's typical comment
 * Shown on the website, and sent to Telegram when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set (free).
 */
export type Alert = { id: number; kind: string; title: string; body: string; link: string | null; created_at: string };

let ready = false;
async function ensureTable() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists alerts (
    id serial primary key, kind text not null, key text not null unique, title text not null,
    body text not null default '', link text, created_at timestamp not null default (now() at time zone 'utc'),
    sent boolean not null default false)`;
  await db`alter table alerts enable row level security`;
  ready = true;
}

export const telegramConfigured = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

async function sendTelegram(text: string): Promise<boolean> {
  if (!telegramConfigured()) return false;
  try {
    const base = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org"; // overridable only for tests
    const res = await fetch(`${base}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function raise(kind: string, key: string, title: string, body: string, link: string | null): Promise<boolean> {
  const db = sql();
  const rows = await db`insert into alerts (kind, key, title, body, link) values (${kind}, ${key}, ${title}, ${body}, ${link})
    on conflict (key) do nothing returning id`;
  if (!rows.length) return false; // already alerted
  const site = process.env.SITE_URL ?? "";
  const sent = await sendTelegram(`${title}\n${body}${link && site ? `\n${site}${link}` : ""}`);
  if (sent) await db`update alerts set sent = true where id = ${rows[0].id as number}`;
  return true;
}

/** Look for alert-worthy events. Cheap: a few aggregate queries. Returns how many new alerts were raised. */
export async function checkAlerts(): Promise<number> {
  await ensureTable();
  const db = sql();
  let raised = 0;

  // New uploads (published in the last 2 days, first seen in the last 6 hours).
  const uploads = await db`
    select v.id, v.title, ch.title as channel from videos v join channels ch on ch.id = v.channel_id
    where ch.active and v.published_at >= (now() at time zone 'utc') - interval '2 days'
      and v.stats_updated_at >= (now() at time zone 'utc') - interval '6 hours'`;
  for (const v of uploads) {
    if (await raise("upload", `upload:${v.id}`, `🎬 New video from ${v.channel}`, String(v.title), `/videos/${v.id}`)) raised++;
  }

  // Negative spike on videos from the last 7 days.
  const spikes = await db`
    with base as (
      select channel_id, avg(case when sentiment = 'negative' then 1.0 else 0 end) as neg
      from comments where sentiment is not null and published_at >= (now() at time zone 'utc') - interval '60 days'
      group by channel_id),
    recent as (
      select c.video_id, c.channel_id, count(*) as n, avg(case when c.sentiment = 'negative' then 1.0 else 0 end) as neg
      from comments c join videos v on v.id = c.video_id
      where c.sentiment is not null and c.published_at >= (now() at time zone 'utc') - interval '6 hours'
        and v.published_at >= (now() at time zone 'utc') - interval '7 days'
      group by c.video_id, c.channel_id)
    select r.video_id, r.n::int, r.neg::float8, b.neg::float8 as base, v.title, ch.title as channel
    from recent r join base b using (channel_id) join videos v on v.id = r.video_id join channels ch on ch.id = r.channel_id
    where r.n >= 15 and r.neg >= 0.4 and r.neg >= b.neg + 0.2`;
  const day = new Date().toISOString().slice(0, 10);
  for (const s of spikes) {
    if (await raise("negative", `negative:${s.video_id}:${day}`, `⚠️ Negative spike on ${s.channel}`,
      `${Math.round((s.neg as number) * 100)}% of the last ${s.n} comments are negative (usually ${Math.round((s.base as number) * 100)}%) on “${s.title}”`,
      `/videos/${s.video_id}?tab=negative`)) raised++;
  }

  // Viral comments from the last 48 hours.
  const viral = await db`
    with typical as (
      select channel_id, percentile_cont(0.9) within group (order by like_count) as p90
      from comments where published_at >= (now() at time zone 'utc') - interval '60 days' group by channel_id)
    select c.id, c.video_id, c.text, c.like_count, c.author_name, ch.title as channel
    from comments c join typical t using (channel_id) join channels ch on ch.id = c.channel_id
    where c.published_at >= (now() at time zone 'utc') - interval '48 hours'
      and c.like_count >= greatest(100, t.p90 * 20)
    order by c.like_count desc limit 5`;
  for (const c of viral) {
    if (await raise("viral", `viral:${c.id}`, `🔥 Viral comment on ${c.channel} (${c.like_count} likes)`,
      `${c.author_name ?? "Viewer"}: ${String(c.text).slice(0, 200)}`, `/videos/${c.video_id}`)) raised++;
  }
  return raised;
}

export async function recentAlerts(limit = 20): Promise<Alert[]> {
  await ensureTable();
  return (await sql()`select id, kind, title, body, link, created_at from alerts order by created_at desc limit ${limit}`) as unknown as Alert[];
}

export async function sendTestAlert(): Promise<{ ok: boolean; message: string }> {
  if (!telegramConfigured()) return { ok: false, message: "Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel first (see README)." };
  const ok = await sendTelegram("✅ Creator Pulse alerts are connected.");
  return ok ? { ok, message: "Test message sent. Check Telegram." } : { ok, message: "Telegram refused the message. Check the bot token and chat id." };
}
