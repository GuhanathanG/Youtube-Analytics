# Audit: why comments weren't syncing, and what every feature is tested by

Date: 5 November 2026.

## What was wrong

| # | Problem | Evidence | Fix |
|---|---|---|---|
| 1 | **The background job ran out of time before reaching any comments.** It saved each video with several separate database queries. The database is in Sydney and GitHub's servers are in the US, so each query takes about 0.2 s. Saving 150 videos used up the whole time budget. | Run #4 log: `"videos_discovered": 150`, `"comments_saved": 0`, `"stopped_reason": "time limit"`. | Bulk writes: videos, stats and snapshots are saved in a few queries per page instead of several per video. Videos with no comments are marked done in one statement. With 0.2 s added to every query, a new 150-video channel with 3,000 comments now syncs in **31 s** (before: it couldn't finish the videos in 2 minutes). |
| 2 | **Every command spent about 15 s on start-up checks.** It checked every table and column on each run. | Run #4 log: the "Plan" and "Count" steps each took 14–16 s. | A layout fingerprint is stored in `schema_meta`; when it matches, start-up is one query (0.2 s). |
| 3 | **Each YouTube call cost three database queries** for quota accounting. | Code review. | One atomic statement (`insert … on conflict … returning`). |
| 4 | **The scheduled job stopped running.** GitHub only runs schedules from the *default branch*, and the default branch was the development branch `claude/optimistic-euler-itxngj`, not `main`. | GitHub API: `default_branch = claude/optimistic-euler-itxngj`. No scheduled run since 02:18. | **You need to change this** (see below). |
| 5 | **The website's live mode only read comments on videos from the last 30 days.** Older videos depended on the stuck background job (#1). | Code review. | Live mode also downloads comment history, 5 pages (about 500 comments) a minute while the site is open, keeping 2,000 quota units in reserve for live checks. |
| 6 | **The website ran in Washington D.C.** while the database is in Sydney, so every page made several slow trips across the Pacific. | Vercel build log: `iad1`. | `web/vercel.json` now pins the website to Sydney (`syd1`). The free Hobby plan allows choosing any single region. |
| 8 | **Big channels still got 0 comments after fix #1.** The job read a channel's *entire* video list before any comments. Your channel has more than 1,000 videos, so run #5 saved 999 videos in 90 s and then hit the time limit. | Run #5 log: `"videos_discovered": 999`, `"comments_saved": 0`. | Each run reads at most 4 pages (200 videos) of history, after checking the newest page for fresh uploads, then moves on to comments. With 0.2 s per query, a 1,200-video channel gets 3,000 comments in its first run (32 s). Tests: `test_big_channel_gets_comments_in_the_first_run`, `test_new_upload_seen_while_history_is_still_being_walked`. |
| 9 | **Live mode was off on the website you use.** There are two Vercel projects. The working one (`youtube-analytics-web`) only has `DATABASE_URL` and `APP_PASSWORD`. The keys (`YOUTUBE_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `GITHUB_TOKEN`) were added to `creator-pulse`, whose deployments all fail. | Vercel project settings. | **You need to change this** (see below). |
| 10 | **AI analysed 0 comments.** The first model tried (`gemini-3.8-flash`) "thinks" before answering. One request took longer than the AI step's whole time slot (180 s timeout), and the log then wrongly said "all models used up". | Runs #7 and #8 logs: 1–2 requests, `"comments": 0`. | Fast models go first (`gemini-2.5-flash` with thinking off, then Flash-Lite, then Groq `gpt-oss-20b`). Each request waits at most 45 s (Python) or 30 s (website); a slow model is skipped for the rest of the run. Batches are 25 comments. Messages are now accurate: "out of time" vs "used up". Tests: `test_slow_model_is_skipped…`, `test_out_of_time_is_reported_honestly`, `test_fast_models_and_no_thinking_by_default`, e2e "a too-slow AI model was tried once, then skipped". |
| 11 | **Nothing ran while the website was closed.** GitHub's free scheduler skipped 4 of the last 5 two-hour slots, and live mode needed an open tab. | Run list: scheduled runs only at 12:11 and 21:01. | The whole engine now runs on the website server: uploads, new comments, history, AI reading new and backlog comments, AI briefings. It's called every 2 minutes by a free external timer (cron-job.org) through `/api/cron?key=…`, protected by `CRON_SECRET`, plus a daily Vercel cron as backup. The Manage page shows whether it's running 24/7. |
| 7 | The first 3 scheduled runs failed. | Run #1–#3 logs: `Could not parse SQLAlchemy URL`. | Already fixed by you: the `DATABASE_URL` secret now holds a valid address. |

## Settings you need to change (5 minutes)

0. **Vercel: put the keys on the working project.**
   - Open **youtube-analytics-web** → **Settings → Environment Variables**.
   - Add `YOUTUBE_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` and `GITHUB_TOKEN`, with the same values as in `creator-pulse`.
   - Then **Deployments → ⋯ → Redeploy**.
   - Optionally delete the broken `creator-pulse` project (**Settings → General → Delete Project**).

1. **GitHub default branch → `main`**
   Go to <https://github.com/GuhanathanG/Youtube-Analytics/settings>. Under **Default branch**, click the ⇄ switch icon, choose **main**, then **Update** and **I understand, update the default branch**.
2. **Vercel production branch → `main`**
   Open the Vercel project → **Settings → Environments → Production → Branch Tracking**. Set it to `main` and **Save**. On older layouts this is under **Settings → Git → Production Branch**.

## Use cases and their tests

Automated tests run on every change: **Python:** 33 tests, on SQLite and PostgreSQL (`Tests` workflow). **Website:** type check, production build and a 32-check end-to-end test against a real PostgreSQL with stand-in YouTube and AI services (`Website` workflow).

| Use case | Test(s) | Status |
|---|---|---|
| Add a channel by @handle, channel URL, video URL or ID | `test_parse_channel_query`, `test_full_backfill…`, e2e "channel was added from the queue" | ✅ |
| Adding a channel on the website loads its newest videos and comments within seconds | e2e "all 4 videos were stored", "newest comments of the 3 latest videos were loaded" | ✅ |
| Unknown channel is reported as "not found" | `test_unknown_channel_request_is_marked_error` | ✅ |
| Download every past comment, including all replies | `test_full_backfill_gets_every_comment_and_reply` | ✅ |
| History download continues after the daily quota runs out | `test_quota_stops_run_and_next_run_resumes` | ✅ |
| History download finishes within the time budget on a slow, distant database | `test_comments_are_reached_in_the_same_run_as_video_discovery`, `test_discovering_150_videos_takes_few_queries` (fails on the old code) | ✅ new |
| Start-up is fast | `test_startup_check_is_one_query_when_schema_is_current` | ✅ new |
| The website downloads history while it's open | e2e "full comment history of an old video was downloaded" (250/250), "every video is marked complete" | ✅ new |
| New comments are picked up in real time | e2e "3 new comments detected in one live check" | ✅ |
| New uploads are picked up | `test_new_uploads_are_discovered`, e2e "a new upload and its comment were detected" | ✅ |
| Nothing is downloaded twice; quiet videos cost no quota | `test_second_run_is_cheap_and_picks_up_only_new_comments` | ✅ |
| Videos with comments turned off are skipped | `test_comments_disabled_video_is_skipped` | ✅ |
| Several open tabs don't double-spend quota | e2e "a second check within the interval spends no quota" | ✅ |
| Language detection, including Tanglish and Hinglish | `test_detect_language_scripts`, `test_detect_romanized_indian_languages` | ✅ |
| Local sentiment model labels every comment once | `test_analyze_pending_labels_everything_once` | ✅ |
| AI reads comments (sentiment, emotion, flags, aspects, translation) | `test_enrich_comments_labels_and_flags`, e2e "the AI read those comments", "Tanglish comment labelled as positive Tanglish" | ✅ |
| AI starts with Tanglish/Hinglish and uncertain comments | `test_enrich_prioritises_uncertain_and_romanized` | ✅ |
| AI falls back from Gemini to Groq; daily limits are respected | `test_router_falls_back_when_daily_limit_hit`, `…waits_on_per_minute_limit`, `…respects_daily_request_budget`, `…skips_unknown_model…` | ✅ |
| AI stops cleanly when every free model is used up | `test_enrich_stops_cleanly_when_models_used_up` | ✅ |
| AI briefings per video and channel, refreshed only when there's enough new data | `test_insights_written_once_until_enough_new_comments` | ✅ |
| GitHub free minutes are spread over the month | `test_plan_minutes_spreads_monthly_budget`, `test_record_job_rounds_up` | ✅ |
| Old databases are upgraded automatically | Checked by hand against an old-layout PostgreSQL database (columns 18 → 28) | ✅ |
| Supabase's public API can't read the data | Checked by hand: a non-owner role sees 0 rows | ✅ |
| Website: sign-in required; APIs refuse anonymous requests | e2e "pages redirect…", "live API refuses…", "search API refuses…" | ✅ |
| Website: every page renders with real data | e2e: Overview, Comments, Manage, Channel and Video pages, CSV export | ✅ |
| Website: search and CSV export | e2e "search finds the channel", "CSV export contains the matching comment" | ✅ |
| Website: plain-English database errors (Streamlit) | `test_diagnose_database_url` | ✅ |
| Engine runs 24/7 without the site open; timer key required | e2e "timer endpoint refuses a missing key / wrong key", "…runs the engine with the right key", "engine records that the 24/7 timer is active", "Manage page shows the engine running 24/7" | ✅ new |
| AI reads the backlog and writes briefings with nobody on the site | e2e "AI read backlog comments with nobody on the site", "AI briefing written by the engine" | ✅ new |
| A slow AI model doesn't block the AI | `test_slow_model_is_skipped_for_the_rest_of_the_run`, e2e "a too-slow AI model was tried once, then skipped" | ✅ new |
| "Run full sync now" button | Needs your `GITHUB_TOKEN`, so it can't be tested automatically | ☐ check after deploy |
| Real YouTube, Gemini and Groq with your keys | Can only be checked on your deployment | ☐ check after deploy |

## Checking it on your deployment

After the two settings changes and the merge:

1. **Website → Manage → Run full sync now.** In about 3–5 minutes, **Background runs** should show `sync` with comments saved (not 0).
2. **Overview:** the comment counts go up. While the site stays open, the **Live** pill keeps updating, and history keeps filling in without pop-ups.
3. **Manage → Free-tier fuel:** YouTube units go up, and the AI models show requests.
