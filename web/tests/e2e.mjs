/**
 * End-to-end test of the website against a real PostgreSQL and stand-in YouTube/AI services.
 *   DATABASE_URL=postgresql://... node tests/e2e.mjs
 * The database must already have the tables (run `python -m ytanalytics init-db` first).
 * Builds nothing: run `npx next build` before.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import postgres from "postgres";
import { startFake } from "./fake-services.mjs";

const DB = process.env.DATABASE_URL;
const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "e2e-password";
const cookie = `cp_session=${crypto.createHmac("sha256", PASSWORD).update("creator-pulse-session-v1").digest("hex")}`;
const db = postgres(DB, { max: 1 });
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
await db`delete from channel_requests where query = '@livecreator'`;
await db`insert into channel_requests (query, status, created_at) values ('@livecreator', 'pending', now())`;

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, APP_PASSWORD: PASSWORD, YOUTUBE_API_KEY: "test", YOUTUBE_API_BASE: "http://localhost:4100",
    GEMINI_API_KEY: "test", GEMINI_BASE_URL: "http://localhost:4100/", GEMINI_MODELS: "slow-model,fake-model", AI_REQUEST_TIMEOUT: "3", LIVE_BACKFILL_PAGES: "5",
    CRON_SECRET: "e2e-cron-secret-0123456789", ENGINE_BUDGET_SECONDS: "45", INSIGHTS_EVERY_MINUTES: "1",
    GEMINI_NATIVE_BASE: "http://localhost:4100/v1beta", RYD_API_BASE: "http://localhost:4100" },
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
  check("Manage page shows history progress with an estimate", manage.includes("History progress") && manage.includes("Read by AI"));

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
  check("timer analyses the next new video and says which", vaTimer.analysed === 1 && vaTimer.tried?.[0]?.ok === true, JSON.stringify(vaTimer));
  const [{ n: secs }] = await db`select coalesce(sum(tokens),0)::int n from llm_usage where model_key like 'video/%'`;
  check("video seconds counted against the free daily allowance", secs >= 242, `${secs} s`);
  const vp = await (await get("/videos/livevid0001")).text();
  check("video page shows the AI's summary and chapters", vp.includes("hands-on review of a budget phone") && vp.includes("Camera test"));
  check("video page shows like rate and performance", vp.includes("Like rate") && vp.includes("Comment rate"));
  check("video page shows the dislike estimate", vp.includes("Dislikes (estimate)") && vp.includes(">42<"));
  check("video page shows most-discussed moments from comment timestamps", vp.includes("Most-discussed moments") && vp.includes("1:00"));
  check("video page shows YouTube details (category, tags, topics)", vp.includes("Science &amp; Technology") && vp.includes("phones") && vp.includes("Technology"));
  check("video page explains that shares/watch time are owner-only", vp.includes("only visible to the channel"));

  // Use case: every page renders with real data
  for (const path of ["/", "/comments?q=semma", "/manage", `/channels/${ch?.id}`, "/videos/livevid0001", "/api/export?q=semma",
    "/ask", "/ideas", `/compare?c=${ch?.id}`]) {
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
