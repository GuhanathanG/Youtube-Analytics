// Run after tests/e2e.mjs (it fills the yta_e2e database these ids come from), against `next start` on port 3300:
//   APP_PASSWORD=<pw> DATABASE_URL=postgresql://postgres:postgres@localhost:5432/yta_e2e npx next start -p 3300
//   PW=<pw> node tests/ui-audit.mjs
// Full UI audit: every page on desktop and iPhone (errors, overflow, broken states, headings, images, hidden content,
// weight), then the interactive pieces. Prints one line per check and writes audit.json.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire("/home/user/Youtube-Analytics/web/package.json");
const { chromium, devices } = require("playwright");
const B = process.env.BASE ?? "http://localhost:3300";
const PW = process.env.PW;
const CH = "UCzzzzzzzzzzzzzzzzzzlive";
const PAGES = ["/", "/command", "/glance", "/comments", "/comments?q=semma", "/ask", "/ask?t=qs2_UrRZFCjY", `/people/UCasker`, "/analytics", `/analytics?c=${CH}`,
  "/predict", "/predict?title=Top+5+phone+tips&format=long&minutes=10&day=5&hour=18", "/growth", "/outliers", "/outliers?period=all&min=2", "/keywords",
  "/keywords?q=phone+review", "/platforms", `/platforms?yt=${CH}&ig=ig_pulsecreator`, "/radar", `/compare?c=${CH}&c=UCyyyyyyyyyyyyyyyyyytwoo`, "/studio", "/ideas",
  "/manage", `/channels/${CH}`, "/channels/ig_pulsecreator", "/videos/livevid0001", "/videos/livevid0077", `/report/${CH}`, "/concept", "/channels/UCnotarealchannel000000"];
const results = [];
const log = (ok, area, what, detail = "") => { results.push({ ok, area, what, detail }); console.log(`${ok ? "PASS" : "FAIL"}  [${area}] ${what}${detail ? " — " + detail : ""}`); };

const b = await chromium.launch();
async function signIn(ctx) {
  const page = await ctx.newPage();
  await page.goto(B + "/login"); await page.fill('input[type="password"]', PW); await page.click("form button");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return page;
}

for (const [tag, opts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["iphone", devices["iPhone 13"]]]) {
  const ctx = await b.newContext(opts);
  const page = await signIn(ctx);
  for (const p of PAGES) {
    const errs = []; let bytes = 0;
    const onErr = (e) => errs.push(e.message.slice(0, 140));
    const onCon = (m) => { if (m.type() === "error" && !/Failed to load resource.*(ytimg|ggpht|cdninstagram|fbcdn|youtube)|localhost:4100\/thumbs/.test(m.text())) errs.push("console: " + m.text().slice(0, 140)); };
    const onResp = async (r) => { const l = Number(r.headers()["content-length"] ?? 0); bytes += l; };
    page.on("pageerror", onErr); page.on("console", onCon); page.on("response", onResp);
    let status = 0;
    try {
      const res = await page.goto(B + p, { waitUntil: "load", timeout: 90000 }); status = res?.status() ?? 0;
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < H; y += 600) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(120); }
      await page.waitForTimeout(1500);
    } catch (e) { errs.push("goto: " + e.message.slice(0, 100)); }
    const info = await page.evaluate(() => {
      const text = document.body.innerText;
      const h1s = [...document.querySelectorAll("main h1, h1")].map((h) => h.textContent.trim()).filter(Boolean);
      const imgsNoAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length;
      const btnNoName = [...document.querySelectorAll("button, a[href]")].filter((el) => {
        const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim();
        return !name && !el.querySelector("img[alt]:not([alt='']), svg title");
      }).length;
      // Content still hidden by an entrance animation after scrolling through (would mean it never revealed).
      const stuck = [...document.querySelectorAll(".rise, .word > span")].filter((el) => {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
        const cs = getComputedStyle(el); return Number(cs.opacity) < 0.05 && !el.closest("[aria-hidden]") ? true : Number(cs.opacity) < 0.05;
      }).length;
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, broken: /Something went wrong|This page didn't load|Loading is taking longer|This page hit an error/.test(text),
        h1s, imgsNoAlt, btnNoName, stuck, len: text.length };
    });
    const label = `${tag} ${p}`;
    const expect404 = p.includes("notarealchannel");
    // Streaming pages (with a loading screen) send 200 before they know a channel is missing; the page still says so.
    const okStatus = expect404 ? info.h1s.some((h) => /Signal lost/.test(h)) : status === 200;
    log(okStatus && !info.broken, "page", label, `${status}${info.broken ? " broken" : ""}`);
    if (errs.length) log(false, "errors", label, errs.slice(0, 2).join(" | ")); else log(true, "errors", label);
    log(!info.overflow, "layout", `${label} no sideways scroll`);
    log(info.h1s.length >= 1, "a11y", `${label} has a page heading`, info.h1s.length ? info.h1s[0].slice(0, 40) : "none");
    if (info.imgsNoAlt) log(false, "a11y", `${label} images missing alt`, String(info.imgsNoAlt));
    if (info.btnNoName) log(false, "a11y", `${label} buttons/links without a name`, String(info.btnNoName));
    if (info.stuck) log(false, "motion", `${label} content stuck hidden`, String(info.stuck));
    page.off("pageerror", onErr); page.off("console", onCon); page.off("response", onResp);
  }

  // ---------------- interactions
  const step = async (name, fn) => { try { const d = await fn(); log(true, "interact", `${tag} ${name}`, d ?? ""); } catch (e) { log(false, "interact", `${tag} ${name}`, e.message.slice(0, 160)); } };
  if (tag === "desktop") {
    await step("hub menu opens on hover and links to its pages", async () => {
      await page.goto(B + "/"); await page.hover('nav[aria-label="Hubs"] >> text=Market');
      await page.locator('nav[aria-label="Hubs"] a[href="/radar"]').first().waitFor({ state: "visible", timeout: 3000 });
      await page.locator('nav[aria-label="Hubs"] a[href="/radar"]').first().click(); await page.waitForURL(/\/radar/); return "→ /radar";
    });
    await step("channel menu switches the site's channel", async () => {
      await page.goto(B + "/"); await page.click('button[aria-label="Channel shown across the site"]');
      await page.locator('[role="listbox"] >> text=All channels (combined)').click(); await page.waitForTimeout(2500);
      const lab = await page.locator('button[aria-label="Channel shown across the site"]').innerText();
      await page.click('button[aria-label="Channel shown across the site"]'); await page.locator('[role="option"]').first().click(); await page.waitForTimeout(2500);
      const lab2 = await page.locator('button[aria-label="Channel shown across the site"]').innerText();
      if (!/All channels/.test(lab) || /All channels/.test(lab2)) throw new Error(`labels: ${lab} / ${lab2}`); return `${lab.trim()} → ${lab2.trim()}`;
    });
    await step("⌘K search finds a channel", async () => {
      await page.goto(B + "/"); await page.keyboard.press("Control+k"); await page.keyboard.type("Live"); await page.waitForTimeout(1500);
      const t = await page.locator('[cmdk-list], [role="listbox"]').last().innerText(); if (!/Live Creator/.test(t)) throw new Error(t.slice(0, 80)); await page.keyboard.press("Escape");
    });
    await step("overview range tabs change the waveform range", async () => {
      await page.goto(B + "/"); await page.locator('[role="tablist"][aria-label="Time range"] a', { hasText: "7D" }).click(); await page.waitForURL(/range=7/); return "range=7";
    });
    await step("comment field: every lens rearranges without errors", async () => {
      await page.goto(B + "/comments"); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await page.locator("text=Every comment").first().scrollIntoViewIfNeeded(); await page.waitForTimeout(1200);
      for (const l of ["language", "emotion", "channel", "time", "mood"]) { await page.click(`button[role=tab]:has-text("${l}")`); await page.waitForTimeout(700); }
      if (errs.length) throw new Error(errs[0]);
    });
    await step("comment filters update the list", async () => {
      await page.goto(B + "/comments?channel=all"); await page.waitForLoadState("networkidle");
      const word = ((await page.locator("article p").first().innerText()).match(/[A-Za-z]{4,}/) ?? ["video"])[0];
      await page.fill('input[aria-label="Search comments"]', word); await page.waitForURL(new RegExp(`q=${word}`), { timeout: 8000 });
      await page.waitForTimeout(2000); const n = await page.locator("article").count(); if (!n) throw new Error(`no results for ${word}`); return `"${word}": ${n} results`;
    });
    await step("Ask AI thread shows answers with the citation constellation", async () => {
      await page.goto(B + "/ask?t=qs2_UrRZFCjY"); await page.waitForTimeout(1500);
      const n = await page.locator("svg.constellation").count(); const ans = await page.locator("text=Answer").count();
      if (!ans) throw new Error("no answer block"); return `${ans} answers, ${n} constellations`;
    });
    await step("analytics channel pills switch channel", async () => {
      await page.goto(B + "/analytics"); await page.locator('a[href^="/analytics?c=ig_pulsecreator"]').click(); await page.waitForURL(/c=ig_pulsecreator/); return "→ ig_pulsecreator";
    });
    await step("predict draft tester returns an estimate", async () => {
      await page.goto(B + "/predict"); await page.fill('input[name="title"]', "Top 5 phone tips"); await page.click('button:has-text("Estimate")');
      await page.waitForURL(/title=/); await page.locator("text=Expected after 30 days").waitFor({ timeout: 8000 });
    });
    await step("growth: add a goal, then remove it", async () => {
      await page.goto(B + "/growth"); const before = await page.locator('button[aria-label="Remove goal"]').count();
      await page.fill('input[name="target"]', "77M"); await page.click('button:has-text("Add goal")'); await page.waitForTimeout(2500);
      const after = await page.locator('button[aria-label="Remove goal"]').count(); if (after !== before + 1) throw new Error(`${before} → ${after}`);
      await page.locator('button[aria-label="Remove goal"]').last().click(); await page.waitForTimeout(2500);
      const end = await page.locator('button[aria-label="Remove goal"]').count(); if (end !== before) throw new Error(`remove: ${end}`); return `${before} → ${after} → ${end}`;
    });
    await step("radar ranks competitors by typical views", async () => {
      await page.goto(B + "/radar"); const n = await page.locator(".rank-row").count(); return `${n} rows`;
    });
    await step("outlier scatter dots link to videos", async () => {
      await page.goto(B + `/analytics?c=${CH}`); await page.waitForLoadState("networkidle").catch(() => {});
      await page.locator(".outlier-scatter a.sc-dot").first().waitFor({ state: "attached", timeout: 8000 });
      const n = await page.locator(".outlier-scatter a.sc-dot").count(); if (!n) throw new Error("no dots"); return `${n} dots`;
    });
    await step("time slider, hover read-out and chart-type switch", async () => {
      await page.goto(B + "/comments"); const chart = page.locator(".sigchart").first(); await chart.scrollIntoViewIfNeeded(); await page.waitForTimeout(900);
      const brush = chart.locator("[data-brush]"); const before = await brush.locator("[aria-live]").innerText();
      await brush.locator('button:has-text("7")').first().click(); await page.waitForTimeout(300);
      const after = await brush.locator("[aria-live]").innerText(); if (!/7 days/i.test(after)) throw new Error(`range: ${after}`);
      const svg = chart.locator("svg[role=img]"); const box = await svg.boundingBox();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5); await page.waitForTimeout(200);
      const tip = await chart.locator("text=total").count(); if (!tip) throw new Error("no hover read-out");
      await chart.locator('button:has-text("Lines")').click(); await page.waitForTimeout(300);
      const lines = await svg.locator("path.sc-line").count(); if (!lines) throw new Error("no lines after switch");
      return `${before} → ${after} · ${lines} lines`;
    });
    await step("reduced motion: content is visible straight away", async () => {
      const rm = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" }); const p2 = await signIn(rm);
      await p2.goto(B + "/"); await p2.waitForTimeout(800);
      const hidden = await p2.evaluate(() => [...document.querySelectorAll(".rise")].filter((e) => Number(getComputedStyle(e).opacity) < 0.5).length);
      await rm.close(); if (hidden) throw new Error(`${hidden} hidden`);
    });
    await step("signing out returns to the sign-in page", async () => {
      await page.goto(B + "/"); await page.click('button[aria-label="Settings and account"]'); await page.click('button:has-text("Sign out")');
      await page.waitForURL(/\/login/, { timeout: 10000 }); await page.waitForTimeout(1500);
      const left = (await page.context().cookies()).filter((c) => c.name === "cp_session").length;
      await page.goto(B + "/comments"); if (!page.url().includes("/login")) throw new Error(`still signed in (session cookies: ${left})`); return "cookie cleared";
    });
    await step("wrong password shows the error and a magenta pulse", async () => {
      await page.goto(B + "/login"); await page.fill('input[type="password"]', "nope-nope"); await page.click("form button"); await page.waitForTimeout(1500);
      const t = await page.locator('form [role="alert"]').innerText(); const err = await page.locator(".login-orb.err").count(); if (!t || !err) throw new Error(`${t} ${err}`); return t;
    });
  } else {
    await step("phone bottom bar navigates between hubs", async () => {
      await page.goto(B + "/"); await page.locator('nav[aria-label="Hubs"] a', { hasText: "Audience" }).last().click(); await page.waitForURL(/\/comments/);
      await page.locator('nav[aria-label="Hubs"] a', { hasText: "Create" }).last().click(); await page.waitForURL(/\/studio/); return "/comments → /studio";
    });
    await step("phone account menu offers search and sign out", async () => {
      await page.goto(B + "/"); await page.click('button[aria-label="Settings and account"]');
      const t = await page.locator("text=Sign out").count() + await page.locator('button:has-text("Search")').count(); if (t < 2) throw new Error(String(t));
    });
  }
  await ctx.close();
}
await b.close();
writeFileSync(process.env.OUT ?? "audit.json", JSON.stringify(results, null, 1));
const fails = results.filter((r) => !r.ok);
console.log(`\nTOTAL ${results.length} checks, ${results.length - fails.length} pass, ${fails.length} fail`);
