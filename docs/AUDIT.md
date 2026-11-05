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
| 7 | The first 3 scheduled runs failed. | Run #1–#3 logs: `Could not parse SQLAlchemy URL`. | Already fixed by you: the `DATABASE_URL` secret now holds a valid address. |

## Settings you need to change (2 minutes)

1. **GitHub default branch → `main`**
   Go to <https://github.com/GuhanathanG/Youtube-Analytics/settings>. Under **Default branch**, click the ⇄ switch icon, choose **main**, then **Update** and **I understand, update the default branch**.
2. **Vercel production branch → `main`**
   Open the Vercel project → **Settings → Environments → Production → Branch Tracking**. Set it to `main` and **Save**. On older layouts this is under **Settings → Git → Production Branch**.

## Use cases and their tests

Automated tests run on every change: **Python:** 28 tests, on SQLite and PostgreSQL (`Tests` workflow). **Website:** type check, production build and a 24-check end-to-end test against a real PostgreSQL with stand-in YouTube and AI services (`Website` workflow).

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
| "Run full sync now" button | Needs your `GITHUB_TOKEN`, so it can't be tested automatically | ☐ check after deploy |
| Real YouTube, Gemini and Groq with your keys | Can only be checked on your deployment | ☐ check after deploy |

## Checking it on your deployment

After the two settings changes and the merge:

1. **Website → Manage → Run full sync now.** In about 3–5 minutes, **Background runs** should show `sync` with comments saved (not 0).
2. **Overview:** the comment counts go up. While the site stays open, the **Live** pill keeps updating, and history keeps filling in without pop-ups.
3. **Manage → Free-tier fuel:** YouTube units go up, and the AI models show requests.
