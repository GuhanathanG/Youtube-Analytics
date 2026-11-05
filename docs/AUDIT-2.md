# Full audit: UI/UX, use cases, tests, code and security

Date: 5 November 2026. Covers the whole platform after features 1–7 and the video analysis were added.
The first audit (why comments weren't syncing) is in [AUDIT.md](AUDIT.md).

Result: **17 problems found and fixed**, 4 actions for you (secrets and unused services), 0 known vulnerable packages.

## 1. Security audit

| # | Severity | Problem | Fix | Tested by |
|---|---|---|---|---|
| S1 | High | **Sign-in could be guessed endlessly.** There was no limit on wrong passwords. | At most 8 wrong attempts per address and 40 in total per 15 minutes, stored in a `login_attempts` table (`web/lib/login-guard.ts`). | `security.test.ts` |
| S2 | High | **The sign-in cookie never expired** and was the same for everyone with the password. A copied cookie worked forever. | The cookie now carries an expiry date (30 days) and a signature over it (`web/lib/auth.ts`). Old cookies are refused, so **you'll need to sign in once again**. | e2e: "old-style session cookie is refused", "expired session cookie is refused" |
| S3 | Medium | **Open redirect.** A sign-in link like `/login?next=/\evil.com` sent you to another site after signing in. | `safeNext()` only allows paths on this site (`web/lib/safe-next.ts`). | `security.test.ts`, e2e "sign-in ignores an off-site 'next' link" |
| S4 | Medium | **Password check leaked timing.** A normal `===` compare stops at the first wrong character. | Constant-time compare (`safeEqual`). | `security.test.ts` |
| S5 | Medium | **CSV export could carry spreadsheet formulas.** A comment like `=HYPERLINK(...)` would run as a formula in Excel or Sheets. | Cells that start with `= + - @` are prefixed with `'` (`web/lib/csv.ts`). | `security.test.ts`, e2e "CSV export neutralises spreadsheet formulas" |
| S6 | Medium | **No browser security headers.** The site could be framed by other sites (clickjacking), and there was no content policy. | Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy and HSTS (`web/next.config.ts`). Checked: no page shows a policy error. | e2e "security headers are sent" |
| S7 | Low | **The sign-in gate's exception list was loose.** Any path starting with `login` or `api/cron` (e.g. `/login-anything`) skipped the password check. | Exact matches only (`web/proxy.ts`). | e2e "pages redirect to sign-in" |
| S8 | Info | Packages | `npm audit` and `pip-audit`: **0 known vulnerabilities**. | CI |
| S9 | Info | Database | Row-level security is on for every table, including those the website creates (`alerts`, `login_attempts`, `video_analysis`, `live_state`). The public Supabase API can't read any of them. | Code review |
| S10 | Info | Secrets | No secrets are in the code or the repository. API keys only live in Vercel and GitHub settings. Background endpoints need `CRON_SECRET`. | Code review |

## 2. Code audit (line by line)

| # | Problem | Fix |
|---|---|---|
| C1 | **Channel requests could be lost.** If adding a queued channel failed (e.g. a YouTube hiccup), the request disappeared. | It's put back with status "not found" and the reason, shown on Manage. |
| C2 | **Running out of YouTube quota also stopped the AI.** One error ended the whole engine run. | YouTube steps and AI steps run separately, so the AI keeps reading the backlog when YouTube is used up. e2e: "with YouTube quota used up … the AI keeps going". |
| C3 | **Alerts scanned every comment every 2 minutes.** | They run with each briefing turn (about every 10 minutes) or when a new video arrives. The negative-spike baseline uses the last 60 days instead of all history. |
| C4 | **The AI backlog sorted every unread comment on each run.** This gets slow at hundreds of thousands of comments. | A partial index on unread comments plus a query that only looks at the newest 2,000. |
| C5 | **Overview, sidebar and progress re-ran heavy totals on every page view.** | 30-second cache, cleared when you add or pause a channel. |
| C6 | **Compare dropped a channel added seconds ago** and said "add at least two channels". It checked the cached list. | It now checks the database. e2e: "compare shows both channels and their shared audience". |
| C7 | **Video analysis gave up when Google was busy.** Your first real run failed with `503 This model is currently experiencing high demand` on all three models, and failed videos were never tried again. | Each model gets one retry after a short wait. Videos that failed for a temporary reason are tried again after 3 hours. The error now lists every model's reason. |
| C8 | **"100K views per day" on a video uploaded minutes ago.** 1K views in under an hour was stretched to a whole day. | Under one day old it shows "in the first N h" instead. |
| C9 | **Progress could show 277 / 272 comments.** YouTube's own count lags behind. | The total shown is never less than what's stored. |

## 3. UI/UX audit

Every page was opened on a desktop (1440 px) and a phone (390 px) screen, with the browser console checked for errors.

| # | Problem | Fix |
|---|---|---|
| U1 | **Manage was wider than a phone screen** (721 px on a 390 px screen). A long line in the watchlist stretched its column, so the whole page scrolled sideways. | Columns can shrink and long text is cut with "…". |
| U2 | **4 form fields had no label for screen readers.** These were the Ask AI question box, the Ask AI channel picker, the comment search and the "watch a new channel" box. | Labels added. |
| U3 | Console errors | None on any page. The only message, "No available adapters", comes from YouTube's embedded player in a test browser. |
| U4 | Checked and fine | One `h1` per page, every image has alt text, every button and link has a name. The phone navigation bar works. The new security policy blocks nothing (fonts, thumbnails, embedded videos and charts all load). |

## 4. Use cases and test cases

Each row is checked automatically on every change by `web/tests/e2e.mjs`, which runs against a real Postgres with stand-in YouTube, AI, Telegram, GitHub and dislike services. **70 checks, all passing.**

| Use case | Checked by |
|---|---|
| Sign in, stay signed in, get refused with a bad, old or expired cookie | sign-in checks (5) |
| Add a channel by @handle or link; it loads videos and newest comments in seconds | "channel was added from the queue", "all 4 videos were stored", "newest comments … were loaded" |
| New comments appear within one live check, and the AI reads them straight away | "3 new comments detected in one live check", "the AI read the new comments immediately" |
| Full comment history of old videos is downloaded | "full comment history of an old video was downloaded" |
| Multilingual sentiment (e.g. Tanglish) | "Tanglish comment labelled as positive Tanglish" |
| Engine runs 24/7 with the site closed (cron endpoint, secret required) | cron checks |
| YouTube quota used up: the engine says so and the AI carries on | quota check (new) |
| Slow AI model is skipped | "a too-slow AI model was tried once, then skipped" |
| Ask AI answers with cited comments | Ask checks |
| Alerts: new upload reaches Telegram | "upload alert was sent to Telegram" (new) |
| Compare channels and their shared audience | compare check (new) |
| Superfans (same viewer, many warm comments) | superfans check (new) |
| Video analysis (summary, chapters, hook, moments), likes, dislike estimate | video analysis checks |
| Manage shows background runs from GitHub | "Manage page lists recent GitHub runs" (new) |
| CSV export | export checks, including formula safety (new) |
| Every page renders with real data | page sweep (9 pages) |

Unit checks: `web/tests/security.test.ts` covers safe redirects, CSV cells, the session token and constant-time compare. The Python worker has its own pytest suite on SQLite and Postgres.

## 5. What you should do

1. **Change the secrets that were pasted into this chat.**
   - The Supabase database password: Supabase → Project Settings → Database → Reset password. Then update `DATABASE_URL` in Vercel and in GitHub secrets.
   - `CRON_SECRET`: Vercel → Settings → Environment Variables, then the same new value in the cron-job.org URLs.
   - The dashboard password (`APP_PASSWORD`).
2. **Turn off Supabase's public Data API.** Supabase → Project Settings → Data API. Nothing here uses it, and row-level security already blocks it, but off is safer.
3. **Delete the unused services:** the Streamlit app, and the failing `creator-pulse` Vercel project.
4. Sign in to the website again after this update (see S2).
