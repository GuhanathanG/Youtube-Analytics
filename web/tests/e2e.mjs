/**
 * End-to-end test of the website against a real PostgreSQL and stand-in YouTube/AI services.
 *   DATABASE_URL=postgresql://... node tests/e2e.mjs
 * The database must already have the tables (run `python -m ytanalytics init-db` first).
 * Builds nothing: run `npx next build` before.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import postgres from "postgres";
import { sent, startFake } from "./fake-services.mjs";

const DB = process.env.DATABASE_URL;
const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "e2e-password";
const EXP = Math.floor(Date.now() / 1000) + 86400;
const cookie = `cp_session=${EXP}.${crypto.createHmac("sha256", PASSWORD).update(`creator-pulse-session-v2.${EXP}`).digest("hex")}`;
const expired = Math.floor(Date.now() / 1000) - 60;
const expiredCookie = `cp_session=${expired}.${crypto.createHmac("sha256", PASSWORD).update(`creator-pulse-session-v2.${expired}`).digest("hex")}`;
const db = postgres(DB, { max: 1 });
// A second database plays the comment archive (like a free Neon database in production).
const ARCHIVE_DB = DB.replace(/\/([^/?]+)(\?|$)/, "/$1_archive$2");
await db.unsafe(`drop database if exists "${new URL(ARCHIVE_DB).pathname.slice(1)}"`);
await db.unsafe(`create database "${new URL(ARCHIVE_DB).pathname.slice(1)}"`);
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}
const tick = async () => {
  await db`update live_state set last_tick_at = null where id = 1`.catch(() => {});
  const r = await fetch(`${BASE}/api/live`, { method: "POST", headers: { cookie } });
  return r.json();
};
const get = (path, auth = true) => fetch(BASE + path, { headers: auth ? { cookie } : {}, redirect: "manual" });

const fake = await startFake(4100);
await db`delete from comments where channel_id like '%live'`;
await db`delete from videos where channel_id like '%live'`;
await db`delete from channels where id like '%live'`;
await db`delete from channel_requests where query = '@livecreator' or query like 'ig:%'`;
await db`delete from channels where id like 'ig\\_%'`;
await db.unsafe("delete from ig_runs").catch(() => {});
await db`insert into channel_requests (query, status, created_at) values ('@livecreator', 'pending', now())`;

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, APP_PASSWORD: PASSWORD, YOUTUBE_API_KEY: "test", YOUTUBE_API_BASE: "http://localhost:4100",
    GEMINI_API_KEY: "test", GEMINI_BASE_URL: "http://localhost:4100/", GEMINI_MODELS: "slow-model,fake-model", AI_REQUEST_TIMEOUT: "3", LIVE_BACKFILL_PAGES: "5",
    CRON_SECRET: "e2e-cron-secret-0123456789", ENGINE_BUDGET_SECONDS: "45", INSIGHTS_EVERY_MINUTES: "1",
    GEMINI_NATIVE_BASE: "http://localhost:4100/v1beta", RYD_API_BASE: "http://localhost:4100", VIDEO_AI_RETRY_MS: "50", ANALYTICS_CACHE_SECONDS: "0", WEEKLY_REPORT_ANY_DAY: "1", PUSH_ALLOW_HTTP: "1", MEMORY_DUE_CACHE_SECONDS: "0", SUMMARY_EVERY_MINUTES: "0", PAGE_CACHE_SECONDS: "0", ARCHIVE_DATABASE_URL: ARCHIVE_DB, JOB_MAX_GAP_MINUTES: "0",
    TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_CHAT_ID: "42", TELEGRAM_API_BASE: "http://localhost:4100",
    GITHUB_TOKEN: "test-token", GITHUB_API_BASE: "http://localhost:4100",
    APIFY_TOKEN: "test", APIFY_API_BASE: "http://localhost:4100", IG_COMMENT_HOURS: "0", BROWSER_TICK_AFTER_MINUTES: "0", LIST_CACHE_SECONDS: "0", RADAR_CACHE_SECONDS: "0", BIG_CHANNEL_COMMENTS: "100", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret",
    GOOGLE_AUTH_URL: "http://localhost:4100/o/oauth2/auth", GOOGLE_TOKEN_URL: "http://localhost:4100/token", YT_ANALYTICS_BASE: "http://localhost:4100/yta/v2",
    YOUTUBE_RSS_BASE: "http://localhost:4100", WEBSUB_HUB: "http://localhost:4100/subscribe", WEBSUB_CALLBACK_BASE: `http://localhost:${PORT}` },
  stdio: ["ignore", "inherit", "inherit"],
  detached: true, // own process group, so the whole server tree can be stopped
});
for (let i = 0; i < 60; i++) { try { await fetch(BASE + "/login"); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }

try {
  // Security
  check("pages redirect to sign-in without a session", (await get("/", false)).status === 307);
  check("live API refuses requests without a session", (await fetch(`${BASE}/api/live`, { method: "POST" })).status === 401);
  check("search API refuses requests without a session", (await get("/api/search?q=a", false)).status === 401);

  // Use case: a channel queued earlier is added on the first live check
  const t1 = await tick();
  check("first live check succeeds", t1.status === "ok", JSON.stringify(t1));
  const [ch] = await db`select id, title from channels where id like '%live'`;
  check("channel was added from the queue", ch?.title === "Live Creator");
  const [{ n: vids }] = await db`select count(*)::int n from videos where channel_id like '%live'`;
  check("all 4 videos were stored", vids === 4, `${vids}`);
  const [{ n: recent, ai }] = await db`select count(*)::int n, count(ai_at)::int ai from comments where channel_id like '%live' and text not like 'old comment%'`;
  check("newest comments of the 3 latest videos were loaded", recent === 18, `${recent}`);
  check("the AI read those comments", ai === 18, `${ai}`);
  const [tl] = await db`select language, sentiment from comments where text = 'semma video bro' limit 1`;
  check("Tanglish comment labelled as positive Tanglish", tl?.language === "ta-Latn" && tl?.sentiment === "positive", JSON.stringify(tl));
  // Short reactions are labelled by rules and never use a free AI request.
  const [rl] = await db`select ai_model from comments where text = 'semma video bro' limit 1`;
  const [aiRow] = await db`select ai_model from comments where text = 'super explanation' limit 1`;
  check("short reaction labelled by rules, without an AI request", rl?.ai_model === "rules" && !sent.aiPrompts.some((m) => m.includes("semma video bro")),
    JSON.stringify(rl));
  check("other comments still read by the AI", (aiRow?.ai_model ?? "").startsWith("gemini/"), JSON.stringify(aiRow));

  // Use case: history (250 comments on a 90-day-old video) downloads over live checks
  let old = 0;
  for (let i = 0; i < 4 && old < 250; i++) {
    await tick();
    [{ n: old }] = await db`select count(*)::int n from comments where text like 'old comment%'`;
  }
  check("full comment history of an old video was downloaded", old === 250, `${old}/250`);
  const [{ done }] = await db`select bool_and(comments_backfilled) done from videos where channel_id like '%live'`;
  check("every video is marked complete", done === true);

  // Use case: new comments appear on YouTube and are picked up + read by AI
  await fetch("http://localhost:4100/_add");
  const t2 = await tick();
  check("3 new comments detected in one live check", t2.newComments === 3, JSON.stringify(t2));
  check("the AI read the new comments immediately", t2.labelled === 3);

  // Use case: a new upload appears
  await fetch("http://localhost:4100/_upload");
  await db`update live_state set last_uploads_at = null where id = 1`;
  const t3 = await tick();
  check("a new upload and its comment were detected", t3.newVideos === 1 && t3.newComments === 1, JSON.stringify(t3));

  // Use case: two checks in quick succession do not double-spend quota
  const [{ units: before }] = await db`select units from quota_usage order by day desc limit 1`;
  await fetch(`${BASE}/api/live`, { method: "POST", headers: { cookie } });
  const [{ units: after }] = await db`select units from quota_usage order by day desc limit 1`;
  check("a second check within the interval spends no quota", before === after, `${before} -> ${after}`);
  check("quota usage is recorded", before > 0, `${before} units`);

  // Use case: the 24/7 engine (external timer) — security
  check("timer endpoint refuses a missing key", (await fetch(`${BASE}/api/cron`)).status === 401);
  check("timer endpoint refuses a wrong key", (await fetch(`${BASE}/api/cron?key=wrong-key-wrong-key-xx`)).status === 401);

  // Use case: the engine runs without anyone signed in, and the AI works through the backlog
  await db`update comments set ai_at = null, ai_model = null where text like 'old comment%'`;
  await db`update live_state set last_tick_at = null where id = 1`;
  const cronRes = await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  const c1 = await cronRes.json();
  check("timer endpoint runs the engine with the right key", cronRes.status === 200 && c1.status === "ok" && c1.source === "cron", JSON.stringify(c1));
  check("AI read backlog comments with nobody on the site", (c1.aiBacklog ?? 0) >= 100, `${c1.aiBacklog} (parallel batches)`);
  const [{ n: briefings }] = await db`select count(*)::int n from insights where data like '%Tanglish banter%'`;
  check("AI briefing written by the engine", briefings >= 1, `${briefings}`);
  const [{ n: slowReq }] = await db`select coalesce(sum(requests),0)::int n from llm_usage where model_key = 'gemini/slow-model'`;
  check("a too-slow AI model was tried once, then skipped", slowReq === 1, `${slowReq} request(s)`);
  const [st] = await db`select last_cron_at from live_state where id = 1`;
  check("engine records that the 24/7 timer is active", !!st?.last_cron_at);
  const manage = await (await get("/manage")).text();
  check("Manage page shows the engine running 24/7", manage.includes("Running 24/7"));
  check("Manage page shows database storage", manage.includes("Database storage"));
  check("Manage page lists AI video analyses", (await (await get("/manage")).text()).includes("AI video analysis"));
  check("Manage page shows every job with time left and an overall finish time",
    manage.includes("Jobs &amp; time left") && manage.includes("AI reads every comment") && manage.includes("All jobs done"));

  // Feature 1: Ask AI answers from stored comments, with citations
  const askRes = await fetch(`${BASE}/api/ask`, { method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ question: "What do people say about the audio?" }) });
  const ask = await askRes.json();
  check("Ask AI answers with cited comments", askRes.status === 200 && ask.answer?.includes("audio") && ask.citations?.length === 1,
    JSON.stringify({ answer: ask.answer, cited: ask.citations?.length, error: ask.error }));
  check("Ask AI cites a real stored comment", /audio/i.test(ask.citations?.[0]?.text ?? ""), ask.citations?.[0]?.text);
  check("Ask API refuses requests without a session", (await fetch(`${BASE}/api/ask`, { method: "POST", body: "{}" })).status === 401);

  // Feature 2: alerts (the new upload earlier should have raised one)
  const [{ n: uploadAlerts }] = await db`select count(*)::int n from alerts where kind = 'upload'`;
  check("an alert was raised for a new upload", uploadAlerts >= 1, `${uploadAlerts}`);

  // Feature 4: content ideas from request comments
  await db`update live_state set last_tick_at = null where id = 1`;
  await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  const [{ n: ideas }] = await db`select count(*)::int n from insights where scope = 'ideas'`;
  check("content ideas written from viewer requests", ideas >= 1, `${ideas}`);
  const ideasPage = await (await get("/ideas")).text();
  check("Ideas page shows the AI's idea", ideasPage.includes("Budget phone buying guide"));

  // Features 3, 5, 6, 7 render with real data
  const chPage = await (await get(`/channels/${ch?.id}`)).text();
  check("channel page shows topic trends", chPage.includes("Topic trends"));
  check("channel page shows superfans & critics", chPage.includes("Superfans"));
  check("channel page shows early performance of new videos", chPage.includes("Early performance"));
  const overview = await (await get("/")).text();
  check("overview shows alerts", overview.includes("New video from Live Creator"));
  const [{ n: snaps }] = await db`select count(*)::int n from video_snapshots v join videos x on x.id = v.video_id where x.channel_id like '%live'`;
  check("view snapshots recorded for predictions", snaps >= 1, `${snaps}`);

  // Advanced video analysis: AI watches the video, performance, dislike estimate, moments, details
  check("video analysis refuses requests without a session", (await fetch(`${BASE}/api/video-analysis`, { method: "POST", body: "{}" })).status === 401);
  check("video analysis timer refuses a wrong key", (await fetch(`${BASE}/api/video-analysis?key=nope`)).status === 401);
  const va = await (await fetch(`${BASE}/api/video-analysis`, { method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ videoId: "livevid0001" }) })).json();
  check("AI watched a video on request", va.ok === true, JSON.stringify(va));
  const vaTimer = await (await fetch(`${BASE}/api/video-analysis?key=e2e-cron-secret-0123456789`)).json();
  check("timer analyses the new videos it has time for and says which", vaTimer.analysed >= 1 && vaTimer.tried?.length === vaTimer.analysed && vaTimer.tried.every((t) => t.ok), JSON.stringify(vaTimer));
  const [{ n: secs }] = await db`select coalesce(sum(tokens),0)::int n from llm_usage where model_key like 'video/%'`;
  check("video seconds counted against the free daily allowance", secs >= 242, `${secs} s`);
  const vp = await (await get("/videos/livevid0001")).text();
  check("video page shows the AI's summary and chapters", vp.includes("hands-on review of a budget phone") && vp.includes("Camera test"));
  check("video page shows like rate and performance", vp.includes("Like rate") && vp.includes("Comment rate"));
  check("video page shows the dislike estimate", vp.includes("Dislikes (estimate)") && vp.includes(">42<"));
  check("video page shows most-discussed moments from comment timestamps", vp.includes("Most-discussed moments") && vp.includes("1:00"));
  check("video page shows YouTube details (category, tags, topics)", vp.includes("Science &amp; Technology") && vp.includes("phones") && vp.includes("Technology"));
  check("video page explains that shares/watch time are owner-only", vp.includes("only visible to the channel"));

  // ---- Audit additions -------------------------------------------------------------------
  // Security: headers and the sign-in "next" link
  const loginRes = await fetch(`${BASE}/login?next=${encodeURIComponent("/\\evil.com")}`);
  const loginHtml = await loginRes.text();
  const nextField = (loginHtml.match(/<input[^>]*name="next"[^>]*>/) ?? [""])[0];
  check("sign-in ignores an off-site 'next' link", nextField.includes('value="/"') && !nextField.includes("evil"), nextField);
  check("security headers are sent (CSP, frame, nosniff)", (loginRes.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'")
    && loginRes.headers.get("x-frame-options") === "DENY" && loginRes.headers.get("x-content-type-options") === "nosniff");
  check("an old-style (non-expiring) session cookie is refused", (await fetch(BASE + "/", {
    headers: { cookie: `cp_session=${crypto.createHmac("sha256", PASSWORD).update("creator-pulse-session-v1").digest("hex")}` }, redirect: "manual" })).status === 307);
  check("an expired session cookie is refused", (await fetch(BASE + "/", { headers: { cookie: expiredCookie }, redirect: "manual" })).status === 307);

  // Alerts reach Telegram
  check("upload alert was sent to Telegram", sent.telegram.some((m) => String(m.text).includes("New video from Live Creator") && m.chat_id === "42"),
    JSON.stringify(sent.telegram.map((m) => m.text)));

  // GitHub runs listed on Manage (uses GITHUB_TOKEN)
  const manage2 = await (await get("/manage")).text();
  check("Manage page lists recent GitHub runs", manage2.includes("success") && manage2.includes("scheduled"));

  // CSV export is safe in spreadsheets
  await db`insert into comments (id, video_id, channel_id, text, like_count, reply_count, fetched_at, published_at)
    values ('csv-inject', 'livevid0001', ${ch.id}, '=HYPERLINK("http://evil")', 0, 0, now(), now())`;
  const csv2 = await (await get("/api/export?q=HYPERLINK")).text();
  check("CSV export neutralises spreadsheet formulas", csv2.includes(`"'=HYPERLINK(""http://evil"")"`), csv2.split("\n")[1]);

  // Superfans (same viewer, 3+ warm comments) and Compare with two channels + shared audience
  const second = "UC" + "y".repeat(18) + "twoo";
  await db`insert into channels (id, title, active, videos_backfilled, added_at) values (${second}, 'Second Creator', true, true, now())`;
  await db`insert into videos (id, channel_id, title, comments_disabled, comments_backfilled, published_at) values ('secondvid01', ${second}, 'S1', false, true, now())`;
  for (let i = 0; i < 4; i++) {
    await db`insert into comments (id, video_id, channel_id, text, like_count, reply_count, fetched_at, published_at, author_name, author_channel_id, sentiment, sentiment_value)
      values (${"fan-a" + i}, 'livevid0001', ${ch.id}, 'love it', 3, 0, now(), now(), 'Super Fan', 'UCfan', 'positive', 0.9)`;
    await db`insert into comments (id, video_id, channel_id, text, like_count, reply_count, fetched_at, published_at, author_name, author_channel_id, sentiment, sentiment_value)
      values (${"fan-b" + i}, 'secondvid01', ${second}, 'also here', 1, 0, now(), now(), 'Super Fan', 'UCfan', 'positive', 0.8)`;
  }
  const ch2 = await (await get(`/channels/${ch.id}`)).text();
  check("superfans list shows a repeat warm commenter", ch2.includes("Super Fan"));
  const cmpRes = await get(`/compare?c=${ch.id}&c=${second}`);
  const cmp = await cmpRes.text();
  check("compare shows both channels and their shared audience", cmp.includes("Second Creator") && cmp.includes("Shared audience") && /\b1(<!-- -->)? people/.test(cmp),
    `second channel shown: ${cmp.includes("Second Creator")}; panel: ${(cmp.match(/Shared audience.{0,600}/) ?? ["none"])[0].replace(/<[^>]+>/g, " ").slice(0, 200)}`);

  // Unanswered questions board, health score and brand tracker
  for (const [id, text, likes] of [["q-open", "Which mic do you use for outdoor shoots?", 90], ["q-done", "When is part 3 coming?", 80]]) {
    await db`insert into comments (id, video_id, channel_id, text, like_count, reply_count, fetched_at, published_at, author_channel_id, is_question)
      values (${id}, 'livevid0001', ${ch.id}, ${text}, ${likes}, 0, now(), now(), 'UCasker', true)`;
  }
  await db`insert into comments (id, video_id, channel_id, parent_id, text, like_count, reply_count, fetched_at, published_at, author_channel_id)
    values ('q-done.r1', 'livevid0001', ${ch.id}, 'q-done', 'Next Friday!', 3, 0, now(), now(), ${ch.id})`;
  const ideasHtml = await (await get("/ideas")).text();
  check("questions board shows unanswered questions, not ones the creator replied to",
    ideasHtml.includes("Which mic do you use for outdoor shoots?") && !ideasHtml.includes("When is part 3 coming?"));
  const anH = await (await get(`/analytics?c=${ch.id}`)).text();
  check("analytics shows a channel health score and the brand tracker (from video analysis)",
    anH.includes("Channel health") && /Excellent|Healthy|Fair|Needs attention/.test(anH) && anH.includes("PhoneX"));
  const cmpH = await (await get(`/compare?c=${ch.id}&c=${"UC" + "y".repeat(18) + "twoo"}`)).text();
  check("compare shows each channel's health score", cmpH.includes("Health score"));

  // Channels never mix: the channel picked in the top bar scopes Overview, Comments and Ideas
  const as = (focus) => ({ headers: { cookie: `${cookie}; cp_focus=${focus}` }, redirect: "manual" });
  const ov2 = await (await fetch(`${BASE}/`, as(second))).text();
  check("Overview for one channel shows only that channel's comments", ov2.includes("also here") && !ov2.includes("love it"));
  const ov1 = await (await fetch(`${BASE}/`, as(ch.id))).text();
  check("…and the other channel shows only its own", ov1.includes("love it") && !ov1.includes("also here"));
  check("the top bar offers a channel switcher", ov1.includes("Channel shown across the site") && ov1.includes("All channels (combined)"));
  const cm = await (await fetch(`${BASE}/comments`, as(second))).text();
  check("Comments opens on the chosen channel", cm.includes("also here") && !cm.includes("love it"));
  const id2 = await (await fetch(`${BASE}/ideas`, as(second))).text();
  check("Ideas shows only the chosen channel's questions", !id2.includes("Which mic do you use for outdoor shoots?"));
  const allC = await (await fetch(`${BASE}/comments?channel=all&q=also%20here`, as(second))).text();
  check("'All channels' is still available when chosen", allC.includes("also here"));

  // Thumbnail analysis (on the video-analysis timer), weekly report, share links
  await db`update videos set thumbnail_url = 'http://localhost:4100/thumbs/' || id || '/hqdefault.jpg' where channel_id = ${ch.id}`;
  const vaThumbs = await (await fetch(`${BASE}/api/video-analysis?key=e2e-cron-secret-0123456789`)).json();
  check("thumbnails are analysed by the AI on the video-analysis timer", (vaThumbs.thumbnails ?? 0) >= 3, JSON.stringify(vaThumbs));
  check("video page shows the thumbnail check", (await (await get("/videos/livevid0001")).text()).includes("Thumbnail check"));
  check("weekly report sent to Telegram with a link to the full report",
    sent.telegram.some((m) => String(m.text).includes("Weekly report · Live Creator") && String(m.text).includes("Health")),
    JSON.stringify(sent.telegram.map((m) => String(m.text).slice(0, 40))));
  const rep = await get(`/report/${ch.id}`);
  const repHtml = await rep.text();
  check("printable weekly report page works (signed in)", rep.status === 200 && repHtml.includes("Weekly report") && repHtml.includes("Save as PDF"));
  check("report page needs sign-in", (await get(`/report/${ch.id}`, false)).status === 307);
  await get("/manage"); // creates the share table
  await db`insert into share_links (token, channel_id) values ('e2eShareToken0123456789', ${ch.id}), ('e2eRevokedToken012345678', ${ch.id})`;
  await db`update share_links set revoked = true where token = 'e2eRevokedToken012345678'`;
  const shared = await fetch(`${BASE}/share/e2eShareToken0123456789`, { redirect: "manual" });
  const sharedHtml = await shared.text();
  check("share link opens a read-only report without a password", shared.status === 200 && sharedHtml.includes("Live Creator") && sharedHtml.includes("Read-only view"));
  check("shared report has no links into the private site", !/href="\/(videos|channels|manage|comments)/.test(sharedHtml));
  check("revoked or made-up share links don't open", (await fetch(`${BASE}/share/e2eRevokedToken012345678`)).status === 404
    && (await fetch(`${BASE}/share/AAAAAAAAAAAAAAAAAAAAAAAA`)).status === 404);
  const [views] = await db`select views from share_links where token = 'e2eShareToken0123456789'`;
  check("share link views are counted", views.views === 1);

  // Creator Memory: monthly memories, then a profile; shown on the channel page and used by Ask AI
  for (let i = 0; i < 4; i++) {
    await db`update live_state set last_tick_at = null where id = 1`;
    await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  }
  const [mem] = await db`select count(*) filter (where scope = 'month')::int as months, count(*) filter (where scope = 'profile')::int as profiles
    from insights where target_id like ${ch.id + "%"}`;
  check("Creator Memory writes monthly memories and a creator profile", mem.months >= 1 && mem.profiles >= 1, JSON.stringify(mem));
  const chMem = await (await get(`/channels/${ch.id}`)).text();
  check("channel page shows the creator memory", chMem.includes("Creator memory") && chMem.includes("A Tamil tech reviewer with a loyal budget-phone audience."));
  const askMem = await fetch(`${BASE}/api/ask`, { method: "POST", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "How has this audience changed over time?", channelId: ch.id }) });
  check("Ask AI reads the creator memory", askMem.status === 200 && (sent.askPrompts ?? []).some((p) => p.includes("Creator memory") && p.includes("loyal budget-phone audience")),
    `status ${askMem.status}`);

  // Conversations: saved chats with history; follow-ups use earlier turns
  check("chat API needs sign-in", (await fetch(`${BASE}/api/chat`)).status === 401);
  const chat1 = await (await fetch(`${BASE}/api/chat`, { method: "POST", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What do viewers say about the audio?", channelId: ch.id }) })).json();
  const chat2 = await (await fetch(`${BASE}/api/chat`, { method: "POST", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ threadId: chat1.threadId, question: "And what about the editing?" }) })).json();
  const thread = await (await get(`/api/chat?t=${chat1.threadId}`)).json();
  check("a conversation is saved with every question and answer", chat2.threadId === chat1.threadId && thread.messages?.length === 4
    && thread.thread.title.startsWith("What do viewers say about the audio") && thread.thread.channel_id === ch.id, JSON.stringify({ chat1, chat2, n: thread.messages?.length }));
  const lastAsk = (sent.askPrompts ?? []).at(-1) ?? "";
  check("follow-up questions include the earlier conversation", lastAsk.includes("Conversation so far") && lastAsk.includes("What do viewers say about the audio?")
    && lastAsk.includes("And what about the editing?"), lastAsk.slice(0, 200));
  const askPage = await (await get(`/ask?t=${chat1.threadId}`)).text();
  check("Ask AI page lists saved conversations and opens one", askPage.includes("New chat") && askPage.includes("What do viewers say about the audio")
    && askPage.includes("And what about the editing?"));

  // Commenters: names link to a page with everything that person wrote
  const chTop = await (await get(`/channels/${ch.id}`)).text();
  check("channel page lists top commenters with links to their comments", chTop.includes("Top commenters") && chTop.includes(`/people/UCfan?c=${ch.id}`));
  const person = await (await get(`/people/UCfan?c=${ch.id}`)).text();
  check("commenter page shows all their comments on the channel", person.includes("Super Fan") && person.includes("love it") && person.includes("All comments"));
  const personAll = await (await get("/people/UCfan")).text();
  check("commenter page across all channels shows each channel", personAll.includes("Live Creator") && personAll.includes("Second Creator") && personAll.includes("also here"));
  check("unknown commenter shows the not-found page", (await (await get("/people/UCnobodyatall0000000000")).text()).includes("Signal lost"));

  // Phone app (PWA) and push notifications
  const mf = await fetch(`${BASE}/manifest.webmanifest`);
  check("app manifest, service worker and icons load without signing in", mf.status === 200 && (await mf.json()).name === "Creator Pulse"
    && (await fetch(`${BASE}/sw.js`)).status === 200 && (await fetch(`${BASE}/icons/icon-192.png`)).headers.get("content-type") === "image/png");
  check("push key needs sign-in", (await fetch(`${BASE}/api/push`)).status === 401);
  const { publicKey: pushPublicKey } = await (await get("/api/push")).json();
  check("push signing key is created automatically", typeof pushPublicKey === "string" && pushPublicKey.length > 80);
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const pushKeys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
  for (const endpoint of ["http://localhost:4100/push/phone1", "http://localhost:4100/push/gone"]) {
    const r = await fetch(`${BASE}/api/push`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ subscription: { endpoint, keys: pushKeys } }) });
    check(`phone subscribes to notifications (${endpoint.split("/").pop()})`, r.status === 200);
  }
  const pushTest = await (await fetch(`${BASE}/api/push`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) })).json();
  const [subsLeft] = await db`select count(*)::int as n from push_subscriptions`;
  check("test notification delivered; an unsubscribed phone is cleaned up", pushTest.sent === 1 && sent.push === 1 && subsLeft.n === 1, JSON.stringify({ pushTest, push: sent.push, subsLeft }));
  const pushBefore = sent.push;
  await db`insert into comments (id, video_id, channel_id, text, like_count, reply_count, fetched_at, published_at) values ('viral-push', 'livevid0001', ${ch.id}, 'this deserves a million likes', 5000, 0, now(), now())`;
  await db`update live_state set last_tick_at = null where id = 1`;
  await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  check("alerts also arrive as phone notifications", sent.push > pushBefore, JSON.stringify({ pushBefore, after: sent.push }));

  // Live chat: a stream goes live, its chat is read every engine run, then it ends and the AI summarises it
  await fetch("http://localhost:4100/_golive");
  await db`update live_state set last_tick_at = null where id = 1`;
  const lc = await (await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`)).json();
  const [chatN] = await db`select count(*)::int as n, count(*) filter (where amount_micros is not null)::int as supers,
    count(*) filter (where is_question)::int as qs from live_chat where video_id = 'livevid0003'`;
  check("live chat is read while the stream is live (with Super Chats and questions)", chatN.n === 35 && chatN.supers === 1 && chatN.qs >= 7,
    JSON.stringify({ chatN, lc }));
  check("Overview shows the LIVE NOW banner", (await (await get("/")).text()).includes("LIVE NOW"));
  const liveVid = await (await get("/videos/livevid0003")).text();
  check("video page shows the live chat panel", liveVid.includes("Live chat") && liveVid.includes("Super Chats") && liveVid.includes("INR"));
  await fetch("http://localhost:4100/_endlive");
  await db`update live_state set last_tick_at = null where id = 1`;
  await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  await db`update live_state set last_tick_at = null where id = 1`;
  await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  const [ended] = await db`select live_status from videos where id = 'livevid0003'`;
  const [chatSum] = await db`select data from insights where scope = 'livechat' and target_id = 'livevid0003'`;
  check("stream marked ended and its chat summarised by the AI", ended.live_status === "ended" && String(chatSum?.data ?? "").includes("complained about audio"),
    JSON.stringify({ ended, chatSum }));

  // Smarter checking: an old video not checked for a day is re-checked; a 3-day-old one checked 5 min ago is left alone.
  await db`update videos set stats_updated_at = (now() at time zone 'utc') - interval '25 hours' where id = 'livevid0000'`;
  await db`update videos set stats_updated_at = (now() at time zone 'utc') - interval '5 minutes' where id = 'livevid0001'`;
  await db`update live_state set last_tick_at = null where id = 1`;
  await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  const [oldV] = await db`select extract(epoch from ((now() at time zone 'utc') - stats_updated_at))::int as age from videos where id = 'livevid0000'`;
  const [midV] = await db`select extract(epoch from ((now() at time zone 'utc') - stats_updated_at))::int as age from videos where id = 'livevid0001'`;
  check("old video re-checked after a day; recently checked video skipped (saves quota)", oldV.age < 120 && midV.age >= 240,
    JSON.stringify({ old: oldV.age, mid: midV.age }));

  // Advanced analytics: performance, timing, titles, audience and topics
  await db`insert into topics (channel_id, created_at, rank, label, keywords, size, share, sentiment, negative_pct, recent, trend_pct, weekly, examples)
    values (${ch.id}, now(), 0, 'Audio quality complaints', 'audio, sound, mic', 40, 0.3, -0.6, 85, 25, 140,
            '{"2026-10-19": 3, "2026-10-26": 9, "2026-11-02": 28}', '[{"id": "x", "text": "the audio is too low", "likes": 9}]')`;
  const an = await (await get(`/analytics?c=${ch.id}`)).text();
  check("analytics page shows all four sections",
    ["Shorts vs long videos", "Breakout videos", "When uploads do best", "Title styles", "New vs returning commenters",
     "Languages over time", "Audio quality complaints"].every((t) => an.includes(t)),
    ["Shorts vs long videos", "Breakout videos", "When uploads do best", "Title styles", "New vs returning commenters", "Languages over time", "Audio quality complaints"].filter((t) => !an.includes(t)).join(", "));
  check("rising topic shows its trend", /▲(<!-- -->)?\s*(<!-- -->)?140(<!-- -->)?%/.test(an), (an.match(/.{60}▲.{60}/) ?? ["no ▲"])[0]);
  const vpAdv = await (await get("/videos/livevid0001")).text();
  check("video page shows outlier score, first 24 hours and forecast", vpAdv.includes("Outlier score") && vpAdv.includes("First 24 hours") && vpAdv.includes("View forecast"));

  // Instagram (via a stand-in Apify): add an account, get profile + posts, then comments read by the AI
  await db`insert into channel_requests (query, status, created_at) values ('ig:pulsecreator', 'pending', now())`;
  await db`insert into channel_requests (query, status, created_at) values ('ig:nobody_here', 'pending', now())`;
  const ig1 = await tick();
  const [igc] = await db`select title, platform, subscriber_count::int as f, video_count::int as posts from channels where id = 'ig_pulsecreator'`;
  check("Instagram account added with its profile (followers, name)", igc?.platform === "instagram" && igc.title === "Pulse Creator" && igc.f === 5000,
    JSON.stringify({ igc, ig: ig1.instagram }));
  const [{ n: igPosts }] = await db`select count(*)::int n from videos where channel_id = 'ig_pulsecreator'`;
  check("its posts were stored", igPosts === 3, `${igPosts}`);
  const [missing] = await db`select error from channel_requests where query = '@nobody_here' and status = 'error'`;
  check("an Instagram account that doesn't exist is reported", String(missing?.error ?? "").includes("does not exist"), JSON.stringify(missing));
  await tick(); // collects the comments run started by the previous check
  const igCom = await db`select text, parent_id, ai_at, sentiment from comments where channel_id = 'ig_pulsecreator' order by id`;
  check("Instagram comments and replies were stored", igCom.length === 7 && igCom.some((c) => c.parent_id === "ig_IGPOST0001c0"), `${igCom.length}`);
  check("the AI read the Instagram comments", igCom.filter((c) => c.ai_at).length === 7, JSON.stringify(igCom.map((c) => c.sentiment)));
  check("YouTube was never asked about Instagram posts", ![...(sent.ytVideoIds ?? []), ...(sent.ytThreadIds ?? [])].some((id) => String(id).startsWith("ig_")));
  check("every Apify run has a spending cap", (sent.igCaps ?? []).length >= 3 && sent.igCaps.every((c) => Number(c.maxItems) > 0 && Number(c.maxTotalChargeUsd) > 0),
    JSON.stringify(sent.igCaps));
  const [{ spent }] = await db`select sum(cost_usd)::float8 as spent from ig_runs`;
  check("Apify spending is recorded", spent > 0 && spent < 1, `${spent}`);
  const igPage = await (await get("/channels/ig_pulsecreator")).text();
  check("Instagram account page shows followers and an Instagram link", igPage.includes("Followers") && igPage.includes("instagram.com/pulsecreator"));
  const igPost = await (await get("/videos/ig_IGPOST0001")).text();
  check("Instagram post page shows the post and its comments", igPost.includes("Instagram post") && igPost.includes("instagram.com/p/IGPOST0001"));
  // Instagram reels: the engine downloads the reel and the AI watches it, like a YouTube video.
  const [reel] = await db`select media_url, duration from videos where id = 'ig_IGPOST0001'`;
  check("a reel's video link is saved with the post", reel?.media_url === "http://localhost:4100/media/IGPOST0001.mp4" && reel.duration === "PT42S", JSON.stringify(reel));
  const watchReel = await (await fetch(`${BASE}/api/video-analysis`, { method: "POST", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ videoId: "ig_IGPOST0001" }) })).json();
  check("the AI watches an Instagram reel (downloaded and handed over as a file)", watchReel.ok === true && sent.reelDownloads >= 1 && sent.reels >= 1, JSON.stringify(watchReel));
  const reelPage = await (await get("/videos/ig_IGPOST0001")).text();
  check("the reel page shows what the AI saw", reelPage.includes("A quick reel unboxing a new phone"));
  const photo = await (await fetch(`${BASE}/api/video-analysis`, { method: "POST", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ videoId: "ig_IGPOST0002" }) })).json();
  check("a photo post is not sent to the video AI", photo.ok === false && /Only reels/.test(photo.message), JSON.stringify(photo));
  const mg = await (await get("/manage")).text();
  check("Manage shows the Instagram form and budget", mg.includes("Watch on Instagram") && mg.includes("Instagram budget"));

  // Instant uploads: the free RSS feed finds new videos on every run, without the quota-costing upload list
  await db`update live_state set last_uploads_at = (now() at time zone 'utc') where id = 1`;
  const pl0 = sent.playlistCalls ?? 0;
  await fetch("http://localhost:4100/_rssvid");
  const tr = await tick();
  check("a new upload is found through the free RSS feed", tr.newVideos >= 1, JSON.stringify(tr).slice(0, 200));
  check("…without calling YouTube's upload list (saves quota)", (sent.playlistCalls ?? 0) === pl0, `${pl0} -> ${sent.playlistCalls}`);

  // Push notifications (WebSub): the engine subscribes; the hub's check and pushes are verified
  const sub = (sent.hubSubs ?? []).find((x) => (x["hub.topic"] ?? "").includes(ch.id));
  check("the engine subscribes to push notifications for new uploads", !!sub && sub["hub.callback"].includes("/api/websub?key=") && (sub["hub.secret"] ?? "").length > 20,
    JSON.stringify(sent.hubSubs ?? []).slice(0, 200));
  const cb = new URL(sub["hub.callback"]);
  const verify = await fetch(`${cb}&hub.mode=subscribe&hub.topic=${encodeURIComponent(sub["hub.topic"])}&hub.challenge=chal123`);
  check("the hub's subscription check is answered", verify.status === 200 && (await verify.text()) === "chal123");
  const badVerify = await fetch(`${BASE}/api/websub?key=wrong&hub.mode=subscribe&hub.topic=${encodeURIComponent(sub["hub.topic"])}&hub.challenge=x`);
  check("…but not with a wrong key", badVerify.status === 404);
  const { id: pushed } = await (await fetch("http://localhost:4100/_pushvid")).json();
  const atom = `<feed><entry><yt:videoId>${pushed}</yt:videoId><yt:channelId>${ch.id}</yt:channelId></entry></feed>`;
  const sig = crypto.createHmac("sha1", sub["hub.secret"]).update(atom).digest("hex");
  const forged = await fetch(cb, { method: "POST", body: atom, headers: { "x-hub-signature": "sha1=" + "0".repeat(40) } });
  check("a push with a wrong signature is refused", forged.status === 403);
  const okPush = await fetch(cb, { method: "POST", body: atom, headers: { "x-hub-signature": `sha1=${sig}` } });
  const [pv] = await db`select id from videos where id = ${pushed}`;
  check("a signed push saves the new video at once", okPush.status === 204 && !!pv, `${okPush.status} ${!!pv}`);

  // Engine health alarm: a stopped background job is reported on Telegram (once per window)
  await db`insert into run_log (kind, started_at, status) values ('sync', (now() at time zone 'utc') - interval '5 hours', 'ok')`;
  await db`update run_log set started_at = (now() at time zone 'utc') - interval '5 hours'`;
  const tgBefore = sent.telegram.length;
  await db`update live_state set last_tick_at = null where id = 1`;
  await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  check("a stopped background job raises a health alarm on Telegram", sent.telegram.slice(tgBefore).some((m) => String(m.text).includes("Background job stopped")),
    JSON.stringify(sent.telegram.slice(tgBefore)).slice(0, 300));
  await db`update live_state set last_tick_at = null where id = 1`;
  await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`);
  check("…and only once per window", sent.telegram.filter((m) => String(m.text).includes("Background job stopped")).length === 1);
  await db`update run_log set started_at = (now() at time zone 'utc')`;

  // Command Center: ranked next moves with evidence, and the AI brief
  const cmd = await (await fetch(`${BASE}/command`, { headers: { cookie: `${cookie}; cp_focus=${ch.id}` } })).text();
  check("Command Center shows next moves with evidence", cmd.includes("next moves") && /Answer \d+ open question/.test(cmd) && cmd.includes("impact"),
    (cmd.match(/Answer[^<]{0,60}/) ?? ["no move"])[0]);
  check("Command Center shows the AI brief", cmd.includes("Answer the mic question today"));

  // Content Studio: a topic becomes a grounded plan with scored titles; Packaging Lab scores and improves titles
  const studio = (body) => fetch(`${BASE}/api/studio`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  check("Studio refuses requests without a session", (await fetch(`${BASE}/api/studio`, { method: "POST", body: "{}" })).status === 401);
  const plan = await (await studio({ action: "plan", channelId: ch.id, topic: "budget phone camera test" })).json();
  check("Studio creates a video plan", plan.ok === true && Number(plan.id) > 0, JSON.stringify(plan));
  check("…grounded in the channel's own data", (sent.studioPrompts ?? []).at(-1)?.includes("Breakout titles on this channel") && (sent.studioPrompts ?? []).at(-1)?.includes("Viewers keep asking about"));
  const planPage = await (await get(`/studio?d=${plan.id}`)).text();
  check("the plan page shows angles, scored titles, thumbnail, hook and outline",
    planPage.includes("Night test") && planPage.includes("WHICH WINS?") && planPage.includes("Titles, scored for this channel") && planPage.includes("I spent a week shooting"));
  const ranked = (await (await studio({ action: "score", channelId: ch.id, titles: ["my vlog", "5 budget phones tested at night: which camera wins?"] })).json()).scores;
  check("Packaging Lab ranks the stronger title first", ranked?.[0]?.title.startsWith("5 budget") && ranked[0].score > ranked[1].score, JSON.stringify(ranked?.map((r) => [r.title, r.score])));
  const improved = (await (await studio({ action: "rewrite", channelId: ch.id, title: "my vlog" })).json()).scores;
  check("Packaging Lab suggests better titles, scored", improved?.length === 2 && improved.every((t) => typeof t.score === "number"));
  check("Studio page opens", (await get("/studio?tab=lab")).status === 200);

  // Competitor radar: a competitor's breakout shows up on the Radar and as a next move
  const rivalId = "UC" + "y".repeat(18) + "twoo";
  check("Manage offers “Mark as competitor”", (await (await get("/manage")).text()).includes("Mark as competitor"));
  await db`update channels set role = 'competitor' where id = ${rivalId}`;
  for (let k = 0; k < 4; k++) {
    await db`insert into videos (id, channel_id, title, comments_disabled, comments_backfilled, published_at, view_count)
      values (${"rivalold" + k}, ${rivalId}, ${"Daily vlog episode " + k}, false, true, (now() at time zone 'utc') - make_interval(days => ${20 + k}), 1000)
      on conflict (id) do nothing`;
  }
  await db`insert into videos (id, channel_id, title, comments_disabled, comments_backfilled, published_at, view_count)
    values ('rivalhit01', ${rivalId}, 'Smartphone gimbal shootout: cinematic results', false, true, (now() at time zone 'utc') - interval '6 days', 9000),
           ('rivalhit02', ${rivalId}, 'Gimbal tricks for cinematic phone video', false, true, (now() at time zone 'utc') - interval '9 days', 7000)
    on conflict (id) do nothing`;
  await db`delete from panel_cache where key like 'radar:%'`;
  const rad = await (await fetch(`${BASE}/radar`, { headers: { cookie: `${cookie}; cp_focus=${ch.id}` } })).text();
  check("Radar compares you with your competitors", rad.includes("Second Creator") && rad.includes("Side by side") && rad.includes("(you)"));
  check("Radar shows the competitor's breakout", rad.includes("Smartphone gimbal shootout") && /9\.0×|9×/.test(rad));
  check("Radar finds topic gaps you haven't covered", rad.includes("gimbal") && rad.includes("cinematic"));
  const cmdR = await (await fetch(`${BASE}/command`, { headers: { cookie: `${cookie}; cp_focus=${ch.id}` } })).text();
  check("a competitor's breakout becomes a next move", cmdR.includes("Your take on") && cmdR.includes("/studio?topic="));
  const ovR = await (await fetch(`${BASE}/`, { headers: { cookie: `${cookie}; cp_focus=${rivalId}` } })).text();
  check("a competitor is never the site's focus", !ovR.includes("Second Creator ·") );
  await db`update channels set role = null where id = ${rivalId}`;

  // Connect your channel: Google sign-in (read-only) unlocks private analytics, stored encrypted
  const startRes = await fetch(`${BASE}/api/oauth/google/start`, { headers: { cookie }, redirect: "manual" });
  const loc = startRes.headers.get("location") ?? "";
  const stateCookie = (startRes.headers.get("set-cookie") ?? "").match(/cp_oauth_state=([^;]+)/)?.[1];
  const state = new URL(loc).searchParams.get("state");
  check("Connect sends the owner to Google with read-only scopes and a state value", startRes.status === 307 && loc.startsWith("http://localhost:4100/o/oauth2/auth")
    && loc.includes("client_id=test-client") && loc.includes("yt-analytics.readonly") && !!state && stateCookie === state, loc.slice(0, 160));
  const forgedSignIn = await fetch(`${BASE}/api/oauth/google/callback?code=goodcode&state=forged`, { headers: { cookie: `${cookie}; cp_oauth_state=${stateCookie}` }, redirect: "manual" });
  check("a sign-in that didn't start here is refused", (forgedSignIn.headers.get("location") ?? "").includes("connect_error"));
  const signIn = await fetch(`${BASE}/api/oauth/google/callback?code=goodcode&state=${state}`, { headers: { cookie: `${cookie}; cp_oauth_state=${stateCookie}` }, redirect: "manual" });
  check("Google sign-in connects the channel", (signIn.headers.get("location") ?? "").includes("connected=Live%20Creator"), signIn.headers.get("location") ?? "");
  const [auth] = await db`select token from channel_auth where channel_id = ${ch.id}`;
  check("the Google key is stored encrypted", !!auth && !String(auth.token).includes("rt-secret-123"));
  const chOwner = await (await get(`/channels/${ch.id}`)).text();
  check("the channel page shows private analytics", chOwner.includes("Private analytics · connected") && chOwner.includes("Subscriptions feed") && chOwner.includes("41%") && chOwner.includes("Click-through"));
  const vOwner = await (await get("/videos/livevid0001")).text();
  check("the video page shows % watched and flags fast drop-off", vOwner.includes("PRIVATE ANALYTICS") && vOwner.includes("loses viewers faster"));
  const cmdO = await (await fetch(`${BASE}/command`, { headers: { cookie: `${cookie}; cp_focus=${ch.id}` } })).text();
  check("private analytics become next moves", cmdO.includes("Fix the opening of") && cmdO.includes("Lift click-through") && cmdO.includes("Reach beyond your subscribers"));
  check("Manage lists the connected channel", (await (await get("/manage")).text()).includes("numbers up to date"));

  // Pulse Glance: the widget-style home-screen app
  const gl = await (await get("/glance")).text();
  check("Glance shows every channel with its mood, the dock and its own home-screen manifest",
    gl.includes(">Glance<") && gl.includes("Live Creator") && gl.includes("Sentiment") && gl.includes("Ask AI") && gl.includes("/glance.webmanifest"));
  check("Glance needs sign-in", (await get("/glance", false)).status === 307);
  const gm = await (await fetch(`${BASE}/glance.webmanifest`)).json().catch(() => ({}));
  check("Glance installs as its own app (opens on /glance)", gm.start_url === "/glance" && gm.short_name === "Glance");

  // iPhone widget: read-only numbers with its own key (shown on Manage), refused without it
  const mgW = await (await get("/manage")).text();
  check("Manage shows the iPhone widget setup", mgW.includes("iPhone widget") && mgW.includes("Copy widget script"));
  check("widget feed refuses a missing or wrong key", (await fetch(`${BASE}/api/widget`)).status === 401
    && (await fetch(`${BASE}/api/widget?key=${"x".repeat(32)}`)).status === 401);
  const [{ value: wkey }] = await db`select value from app_secrets where name = 'widget_token'`;
  const wd = await (await fetch(`${BASE}/api/widget?key=${encodeURIComponent(wkey)}`)).json();
  check("widget feed returns each channel's numbers", wd.channels?.some((c) => c.title === "Live Creator" && typeof c.comments24h === "number" && c.positive >= 0),
    JSON.stringify(wd).slice(0, 300));
  check("widget feed has no comment text", !JSON.stringify(wd).includes("semma"));
  check("the copied script contains this site's key", mgW.includes(wkey));
  const wd1 = await (await fetch(`${BASE}/api/widget?key=${encodeURIComponent(wkey)}&c=${ch.id}`)).json();
  check("widget can show one channel", wd1.channels?.length === 1 && wd1.channels[0].id === ch.id);

  // When YouTube's daily quota is used up, the AI still works through its backlog
  await db`update comments set ai_at = null, ai_model = null where text like 'old comment%'`;
  await db`insert into quota_usage (day, units) values (to_char((now() at time zone 'America/Los_Angeles'), 'YYYY-MM-DD'), 99999)
    on conflict (day) do update set units = 99999`;
  await db`update live_state set last_tick_at = null, last_uploads_at = null where id = 1`;
  const q = await (await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`)).json();
  check("with YouTube quota used up, the engine reports it and the AI keeps going", q.status === "quota" && (q.aiBacklog ?? 0) > 0, JSON.stringify(q));
  await db`update quota_usage set units = 0`;

  check("engine starts the GitHub background job when GitHub's scheduler skipped it", (sent.dispatches ?? 0) > 0, `dispatches: ${sent.dispatches}`);
  // …but not while the always-on server (Hugging Face Space) is working
  await db`create table if not exists worker_heartbeat (name varchar(40) primary key, at timestamp not null, started_at timestamp, cycles integer not null default 0, info text)`;
  await db`insert into worker_heartbeat (name, at, cycles, info) values ('space', (now() at time zone 'utc'), 1, 'sync exit 0')
    on conflict (name) do update set at = excluded.at`;
  const d0 = sent.dispatches ?? 0;
  await db`update live_state set last_tick_at = null where id = 1`;
  const kw = await (await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`)).json();
  check("the GitHub job is not started while the always-on server works", (sent.dispatches ?? 0) === d0 && kw.job === "always-on server working", JSON.stringify({ job: kw.job, d0, d1: sent.dispatches }));
  const mgS = await (await get("/manage")).text();
  check("Manage shows the always-on server", mgS.includes("Always-on server") && mgS.includes("working"));
  await db`delete from worker_heartbeat`;

  // Archiving: old, read comments move to the archive database; totals stay; Ask AI still finds them
  // Fresh channel totals: one channel's summary is refreshed per engine run, so run it once per channel
  // (this also picks up any comments still arriving from earlier steps).
  const settle = async () => { for (let i = 0; i < 4; i++) { await db`update live_state set last_tick_at = null where id = 1`;
    await fetch(`${BASE}/api/cron?key=e2e-cron-secret-0123456789`); } };
  await settle();
  const [archBefore] = await db`select coalesce(sum(comments), 0)::int as n from channel_summary where channel_id like '%live'`;
  const { spawnSync } = await import("node:child_process");
  const py = spawnSync("python", ["-m", "ytanalytics", "archive"], { cwd: "..", encoding: "utf8",
    env: { ...process.env, DATABASE_URL: DB, ARCHIVE_DATABASE_URL: ARCHIVE_DB, ARCHIVE_FORCE: "1", ARCHIVE_AFTER_DAYS: "0" } });
  const moved = Number((/"archived": (\d+)/.exec(py.stdout ?? "") ?? [])[1] ?? 0);
  check("old, already-read comments are moved to the archive database", moved > 0, (py.stdout + py.stderr).slice(-300));
  const [{ n: liveAudio }] = await db`select count(*)::int as n from comments where text = 'audio is bad' and ai_at is not null and like_count < 25`;
  check("moved comments are gone from the main database", liveAudio === 0);
  await settle();
  const [archAfter] = await db`select coalesce(sum(comments), 0)::int as n from channel_summary where channel_id like '%live'`;
  check("channel totals still include archived comments", archAfter.n === archBefore.n, JSON.stringify({ before: archBefore.n, after: archAfter.n, moved }));
  const askArch = await fetch(`${BASE}/api/ask`, { method: "POST", headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What do viewers say about the audio?", channelId: ch.id }) });
  check("Ask AI still finds archived comments", askArch.status === 200 && (sent.askPrompts ?? []).at(-1)?.includes("audio is bad"));

  // Prediction engine: trains on history (here: 200 older practice videos where numbers in the title double the views),
  // then the website shows its accuracy, the drivers, forecasts, a what-if estimate and engine-based next moves.
  await db`insert into videos (id, channel_id, title, duration, published_at, view_count, like_count, comment_count, comments_disabled, comments_backfilled)
    select 'mdl' || g, ${ch.id}, case when g % 2 = 0 then 'Top ' || g || ' tips' else 'My day out' end, 'PT12M',
      (now() at time zone 'utc') - make_interval(days => 20 + g * 2), (case when g % 2 = 0 then 20000 else 10000 end) * (0.85 + (g % 7) * 0.05),
      400, 30, false, true from generate_series(1, 200) g on conflict do nothing`;
  const trainRun = spawnSync("python", ["-m", "ytanalytics", "train"], { cwd: "..", encoding: "utf8", env: { ...process.env, DATABASE_URL: DB } });
  const trained = /"trained": true/.test(trainRun.stdout ?? "");
  check("prediction engine trains on the channel history", trained, (trainRun.stdout + trainRun.stderr).slice(-400));
  // Training kept this script busy for a while, so the server may have closed the idle connection: retry once.
  const getF = (path) => fetch(`${BASE}${path}`, { headers: { cookie: `${cookie}; cp_focus=${ch.id}` } })
    .catch(() => fetch(`${BASE}${path}`, { headers: { cookie: `${cookie}; cp_focus=${ch.id}`, connection: "close" } }));
  const pr = await (await getF("/predict")).text();
  check("Predict page shows its tested accuracy and the measured driver", pr.includes("Lands within 2×") && pr.includes("Numbers in the title")
    && pr.includes("Where new uploads will land"));
  const wi = await (await getF("/predict?title=Top+7+tips&format=long&minutes=12&day=5&hour=18")).text();
  const wo = await (await getF("/predict?title=My+day+out&format=long&minutes=12&day=5&hour=18")).text();
  const mult = (h) => Number((/([\d.]+)×(?:<!-- -->)? this channel/.exec(h) ?? [])[1] ?? NaN);
  check("what-if: a title with a number is estimated higher (as the engine learned)", mult(wi) > mult(wo), `${mult(wi)} vs ${mult(wo)} ${wi.slice(wi.indexOf("Expected after"), wi.indexOf("Expected after") + 300)}`);
  check("next moves include the engine's finding", (await (await getF("/command")).text()).includes("Lean into: numbers in the title"));
  const [young] = await db`select video_id from video_forecast where channel_id = ${ch.id} limit 1`;
  check("a young video shows the engine's 30-day forecast", Boolean(young) && (await (await get(`/videos/${young.video_id}`)).text()).includes("Engine forecast"));

  // Heavy-work run: big channels' heavy sections are worked out in the background, one run at a time
  check("heavy-work run refuses a wrong key", (await fetch(`${BASE}/api/heavy?key=nope`)).status === 401);
  const heavy = await (await fetch(`${BASE}/api/heavy?key=e2e-cron-secret-0123456789&wait=1`)).json();
  check("heavy-work run works out the big channel's heavy sections", heavy.done?.some((d) => d.startsWith(`audience:${ch.id}`)), JSON.stringify(heavy).slice(0, 300));
  const [lock] = await db`select 1 from panel_cache where key = 'lock:heavy'`;
  check("heavy-work run releases its lock", !lock);

  // Use case: every page renders with real data
  for (const path of ["/", "/comments?q=semma", "/manage", `/channels/${ch?.id}`, "/videos/livevid0001", "/api/export?q=semma",
    "/ask", "/ideas", `/compare?c=${ch?.id}`, "/analytics"]) {
    const r = await get(path);
    const body = await r.text();
    check(`page ${path} loads`, r.status === 200 && !body.includes("Something went wrong"), `${r.status}`);
  }
  const csv = await (await get("/api/export?q=semma")).text();
  check("CSV export contains the matching comment", csv.includes("semma video bro"));
  const search = await (await get("/api/search?q=live")).json();
  check("search finds the channel", search.channels?.some((c) => c.title === "Live Creator"));
} finally {
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill(); }
  fake.close();
  await db.end();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
