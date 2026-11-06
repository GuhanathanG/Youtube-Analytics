import "server-only";
import crypto from "node:crypto";
import { sql, ensureRls } from "./db";
import { safeEqual } from "./auth";
import { summaries } from "./summary";
import { channels as getChannels } from "./queries";
import { lastTick } from "./live";

/**
 * iPhone home-screen widget (via the free Scriptable app). The widget can't sign in, so it reads a
 * small, read-only summary with its own key. The key lives in the database (created on first use),
 * is shown only on the signed-in Manage page, and can be replaced there at any time, which stops
 * every old widget at once. The summary holds numbers and titles only: no comment text.
 */
async function ensureTable() {
  await sql()`create table if not exists app_secrets (name text primary key, value text not null)`;
  await ensureRls("app_secrets");
}

export async function widgetToken(): Promise<string> {
  await ensureTable();
  const [r] = await sql()`select value from app_secrets where name = 'widget_token'`;
  if (r) return r.value as string;
  await sql()`insert into app_secrets (name, value) values ('widget_token', ${crypto.randomBytes(24).toString("base64url")})
    on conflict (name) do nothing`;
  return widgetToken();
}

export async function rotateWidgetToken(): Promise<string> {
  await ensureTable();
  const fresh = crypto.randomBytes(24).toString("base64url");
  await sql()`insert into app_secrets (name, value) values ('widget_token', ${fresh})
    on conflict (name) do update set value = excluded.value`;
  return fresh;
}

export async function checkWidgetToken(key: string | null): Promise<boolean> {
  if (!key || key.length < 20 || key.length > 100) return false;
  return safeEqual(key, await widgetToken());
}

export type WidgetChannel = {
  id: string; title: string; thumb: string | null; platform: "youtube" | "instagram"; followers: number | null; comments: number; comments24h: number;
  sentiment: number | null; positive: number; neutral: number; negative: number; aiRead: number;
};
export type WidgetData = { at: string; engine: string | null; engineAt: string | null; channels: WidgetChannel[] };

export async function widgetData(channelId?: string | null): Promise<WidgetData> {
  const [chs, sums, tick] = await Promise.all([getChannels(), summaries(), lastTick().catch(() => null)]);
  const list = chs.filter((c) => c.active && (!channelId || c.id === channelId)).map((c) => {
    const s = sums.get(c.id);
    const analysed = c.positive + c.neutral + c.negative;
    const pct = (n: number) => (analysed ? Math.round((n / analysed) * 100) : 0);
    return {
      id: c.id, title: c.title, thumb: c.thumbnail_url, platform: c.id.startsWith("ig_") ? "instagram" : "youtube",
      followers: c.subscriber_count, comments: c.comments, comments24h: s?.comments_24h ?? 0,
      sentiment: c.avg_sentiment === null ? null : Math.round(c.avg_sentiment * 100),
      positive: pct(c.positive), neutral: pct(c.neutral), negative: pct(c.negative),
      aiRead: c.comments ? Math.round(((s?.ai_read ?? 0) / c.comments) * 100) : 0,
    } satisfies WidgetChannel;
  });
  return { at: new Date().toISOString(), engine: tick?.status ?? null, engineAt: tick?.at ?? null, channels: list };
}

/** The Scriptable script, with this site's address and the key filled in. */
export function scriptableScript(siteUrl: string, key: string): string {
  return `// Creator Pulse widget for Scriptable (free on the App Store).
// Long-press the home screen → + → Scriptable → pick this script. Widget parameter (optional): a channel id.
const SITE = ${JSON.stringify(siteUrl)};
const KEY = ${JSON.stringify(key)};
const channel = (args.widgetParameter || "").trim();

async function load() {
  const url = SITE + "/api/widget?key=" + encodeURIComponent(KEY) + (channel ? "&c=" + encodeURIComponent(channel) : "");
  const req = new Request(url);
  req.timeoutInterval = 20;
  return await req.loadJSON();
}
const fmt = (n) => n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
const color = (s) => s == null ? new Color("#9aa4b2") : s > 15 ? new Color("#34d399") : s < -15 ? new Color("#f87171") : new Color("#fbbf24");

const w = new ListWidget();
w.backgroundColor = new Color("#05070d");
w.url = SITE;
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
try {
  const data = await load();
  const head = w.addText("PULSE");
  head.font = Font.boldSystemFont(10); head.textColor = new Color("#22d3ee");
  w.addSpacer(4);
  const family = config.widgetFamily || "medium";
  const show = data.channels.slice(0, family === "small" ? 1 : family === "large" ? 5 : 2);
  if (!show.length) w.addText("No channels yet").textColor = Color.white();
  for (const c of show) {
    const t = w.addText(c.title);
    t.font = Font.semiboldSystemFont(family === "small" ? 13 : 14); t.textColor = Color.white(); t.lineLimit = 1;
    const row = w.addStack(); row.centerAlignContent();
    const s = row.addText((c.sentiment == null ? "–" : (c.sentiment > 0 ? "+" : "") + c.sentiment) + " mood");
    s.font = Font.boldSystemFont(12); s.textColor = color(c.sentiment);
    row.addSpacer(8);
    const n = row.addText("+" + fmt(c.comments24h) + " today · " + fmt(c.followers) + (c.platform === "instagram" ? " followers" : " subs"));
    n.font = Font.systemFont(11); n.textColor = new Color("#c7cdd6"); n.lineLimit = 1;
    if (family !== "small") {
      const m = w.addText(c.positive + "% 😊  " + c.neutral + "% 😐  " + c.negative + "% 😠 · AI read " + c.aiRead + "%");
      m.font = Font.systemFont(10); m.textColor = new Color("#9aa4b2");
    }
    w.addSpacer(6);
  }
  w.addSpacer();
  const f = w.addText("Updated " + new Date(data.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + (data.engine && data.engine !== "ok" ? " · engine: " + data.engine : ""));
  f.font = Font.systemFont(9); f.textColor = new Color("#6b7280");
} catch (e) {
  const t = w.addText("Pulse: can't load right now");
  t.textColor = Color.white(); t.font = Font.systemFont(12);
}
if (config.runsInWidget) Script.setWidget(w); else await w.presentMedium();
Script.complete();
`;
}
