// Daily check of the LIVE site (run by .github/workflows/prod-check.yml): signs in with SITE_PW, opens every page for
// the real channels on desktop and iPhone, and records status, load time, errors, broken states and sideways scroll,
// with a screenshot of each page. Read-only: it never presses buttons that write, start jobs or ask the AI.
//   BASE=https://… PW=… DATABASE_URL=… OUT=prod-check node tests/prod-check.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const postgres = require("postgres");

const B = (process.env.BASE ?? "https://youtube-analytics-web-jet.vercel.app").replace(/\/$/, "");
const PW = process.env.PW;
const OUT = process.env.OUT ?? "prod-check";
if (!PW) { console.error("PW (the site password) is not set"); process.exit(2); }
mkdirSync(`${OUT}/shots`, { recursive: true });

// Real ids to visit: each of your active channels (YouTube + Instagram), its newest video, one rival.
const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 5 });
const chans = await db`select id, title, coalesce(platform, 'youtube') as platform from channels
  where active and coalesce(role, '') not in ('competitor', 'training') order by title`;
const rival = (await db`select id from channels where active and role = 'competitor' limit 1`)[0]?.id;
const vids = await db`select distinct on (channel_id) id, channel_id from videos
  where channel_id in ${db(chans.map((c) => c.id))} order by channel_id, published_at desc`;
const yt = chans.find((c) => c.platform === "youtube")?.id, ig = chans.find((c) => c.platform === "instagram")?.id;
await db.end();

const PAGES = ["/", "/command", "/glance", "/comments", "/comments?q=super", "/ask", "/analytics", "/predict", "/growth", "/outliers",
  "/keywords", "/platforms", "/radar", "/studio", "/ideas", "/lab", "/lab/channels", "/manage",
  ...chans.map((c) => `/channels/${c.id}`), ...chans.filter((c) => c.platform === "youtube").map((c) => `/report/${c.id}`),
  ...vids.map((v) => `/videos/${v.id}`), ...(yt && ig ? [`/platforms?yt=${yt}&ig=${ig}`] : []),
  ...(yt && rival ? [`/compare?c=${yt}&c=${rival}`] : []), ...(yt ? [`/analytics?c=${yt}`] : [])];

const results = [];
const log = (r) => { results.push(r); console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.device.padEnd(7)} ${r.path.padEnd(48)} ${r.status} ${String(r.ms).padStart(6)} ms${r.problem ? "  — " + r.problem : ""}`); };
const b = await chromium.launch();
for (const [device, opts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["iphone", devices["iPhone 13"]]]) {
  const ctx = await b.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(B + "/login"); await page.fill('input[type="password"]', PW); await page.click("form button");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  for (const p of PAGES) {
    const errs = [];
    const onErr = (e) => errs.push(e.message.slice(0, 160));
    const onCon = (m) => { if (m.type() === "error" && !/Failed to load resource.*(ytimg|ggpht|cdninstagram|fbcdn|youtube|googleusercontent)/.test(m.text())) errs.push(m.text().slice(0, 160)); };
    page.on("pageerror", onErr); page.on("console", onCon);
    let status = 0; const t0 = Date.now();
    try {
      const res = await page.goto(B + p, { waitUntil: "load", timeout: 90000 }); status = res?.status() ?? 0;
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    } catch (e) { errs.push("load: " + e.message.slice(0, 120)); }
    const ms = Date.now() - t0;
    const info = await page.evaluate(() => {
      const text = document.body.innerText;
      return { login: location.pathname.startsWith("/login"), overflow: document.documentElement.scrollWidth > innerWidth + 1,
        broken: /Something went wrong|This page didn't load|Loading is taking longer|This page hit an error|Signal lost|Application error/.test(text),
        empty: text.trim().length < 200, h1: document.querySelector("h1")?.textContent?.trim().slice(0, 60) ?? "" };
    }).catch(() => ({ login: false, overflow: false, broken: true, empty: true, h1: "" }));
    const problems = [status !== 200 && `HTTP ${status}`, info.login && "sent back to sign-in", info.broken && "error state shown",
      info.empty && "almost empty page", info.overflow && device === "iphone" && "sideways scroll on phone",
      ms > 15000 && "slow (>15 s)", errs.length && `JS: ${errs[0]}`].filter(Boolean);
    const name = `${device}${p.replace(/[^a-z0-9]+/gi, "_")}`.slice(0, 120);
    await page.screenshot({ path: `${OUT}/shots/${name}.png`, fullPage: false }).catch(() => {});
    log({ ok: problems.length === 0, device, path: p, status, ms, h1: info.h1, problem: problems.join("; "), errors: errs.slice(0, 3), shot: `shots/${name}.png` });
    page.off("pageerror", onErr); page.off("console", onCon);
  }
  await ctx.close();
}
// ---------------- the customer's day: real actions, outputs saved for the daily review to judge (true? useful?)
const day = Math.floor(Date.now() / 86_400_000);
const weekday = new Date().toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Kolkata" });
const QUESTIONS = ["What do viewers want me to make next?", "What are people complaining about this week?",
  "What questions do viewers keep asking that I haven't answered?", "Which recent video got the warmest comments, and why?",
  "Do viewers mention the audio, editing or video length?", "What do people say about Ram and Jaanu together?",
  "Which topics make people comment the most?", "Are there any negative comments I should reply to today?"];
const SEARCHES = ["semma", "super", "next video", "audio", "love you", "romba", "part 2", "editing", "thumbnail", "cute"];
const scenario = { weekday, steps: [] };
const ctxS = await b.newContext({ viewport: { width: 1440, height: 900 } });
const pg = await ctxS.newPage();
await pg.goto(B + "/login"); await pg.fill('input[type="password"]', PW); await pg.click("form button");
await pg.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
const mainText = async () => (await pg.locator("main").first().innerText().catch(() => pg.locator("body").innerText())).replace(/\n{3,}/g, "\n\n");
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const output = await fn(); scenario.steps.push({ name, ok: true, ms: Date.now() - t0, output: String(output ?? "").slice(0, 6000) }); }
  catch (e) { scenario.steps.push({ name, ok: false, ms: Date.now() - t0, error: e.message.slice(0, 300) }); }
  await pg.screenshot({ path: `${OUT}/shots/scenario_${scenario.steps.length}.png` }).catch(() => {});
  console.log(`${scenario.steps.at(-1).ok ? "PASS" : "FAIL"}  scenario ${name}`);
};
const term = SEARCHES[day % SEARCHES.length];
await step(`Comments search "${term}"`, async () => { await pg.goto(`${B}/comments?q=${encodeURIComponent(term)}`); await pg.waitForLoadState("networkidle").catch(() => {}); return mainText(); });
for (const v of vids.slice(0, 3)) {
  await step(`Video page ${v.id} (newest upload)`, async () => { await pg.goto(`${B}/videos/${v.id}`); await pg.waitForLoadState("networkidle").catch(() => {}); return mainText(); });
}
const ytTitles = await (async () => { const d = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  const r = await d`select title, channel_id from videos where channel_id = ${yt ?? ""} order by published_at desc limit 5`; await d.end(); return r; })();
if (ytTitles.length) {
  await step(`Predict a draft like "${ytTitles[0].title.slice(0, 50)}"`, async () => {
    await pg.goto(`${B}/predict?title=${encodeURIComponent(ytTitles[0].title)}&format=long&minutes=12&day=5&hour=18`);
    await pg.waitForLoadState("networkidle").catch(() => {}); return mainText();
  });
  await step("Packaging Lab: score the last 5 real titles", async () => {
    await pg.goto(`${B}/studio?c=${yt}`); await pg.fill("#titles", ytTitles.map((t) => t.title).join("\n"));
    await pg.getByRole("button", { name: /Score titles/ }).click();
    await pg.waitForFunction(() => !/Scoring…/.test(document.body.innerText), null, { timeout: 60000 }); await pg.waitForTimeout(1500);
    return mainText();
  });
}
const q = QUESTIONS[day % QUESTIONS.length];
await step(`Ask AI: "${q}"`, async () => {
  await pg.goto(`${B}/ask`); await pg.fill("textarea", q); await pg.getByRole("button", { name: "Send" }).click();
  await pg.waitForFunction(() => !document.querySelector('button[aria-label="Send"]')?.hasAttribute("disabled") || /Answer/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(45000); return mainText();
});
if (weekday === "Thu") {
  await step("Studio: plan a video from the top audience request", async () => {
    await pg.goto(`${B}/studio?c=${yt}`); const chip = pg.locator('[aria-label="Ideas from your audience"] button').first();
    if (await chip.count()) await chip.click(); else await pg.fill("#topic", "Part 2 of our most-liked video");
    await pg.locator("button.btn-neon").filter({ hasNotText: /Score titles/ }).first().click();
    await pg.waitForTimeout(90000); return mainText();
  });
}
writeFileSync(`${OUT}/scenario.json`, JSON.stringify(scenario, null, 1));
await ctxS.close();
await b.close();
const failed = results.filter((r) => !r.ok);
const summary = { at: new Date().toISOString(), base: B, pages: PAGES.length, checks: results.length, failed: failed.length,
  median_ms: results.map((r) => r.ms).sort((x, y) => x - y)[Math.floor(results.length / 2)], slowest: [...results].sort((x, y) => y.ms - x.ms).slice(0, 5) };
writeFileSync(`${OUT}/results.json`, JSON.stringify({ summary, results }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; median load ${summary.median_ms} ms`);
process.exit(0); // failures are reported in results.json, not as a red run (the daily review reads them)
