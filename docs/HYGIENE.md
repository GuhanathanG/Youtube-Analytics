# Hygiene check — 22 Nov 2026

## Summary
| Area | Result |
|---|---|
| Secrets in the repo (files and full git history) | ✅ None. The only database addresses are placeholders in examples, the README and tests. `.env` files are ignored. |
| Web packages (`npm audit`) | ✅ 0 vulnerabilities |
| Python packages (`pip-audit`, all requirement files) | ✅ No known vulnerabilities |
| Live site (Vercel) | ✅ Latest production deploy (#100) is READY. 1 runtime error in 7 days: a single `/api/cron` timeout on 16 Nov. |
| Background jobs (last 60 GitHub Actions runs) | ✅ Sync & analyze 55/55. Prediction engine 2/2. ⚠️ Read archived comments: 1 failure on 21 Nov (**fixed**, see below). |
| Database (Supabase Mumbai) | ✅ 129 MB in total (comments 76 MB). Connections are normal. ⚠️ Advisor warnings handled below. |
| Tests | ✅ e2e 213/213 · UI audit 266/266 · web unit tests · Python 78 passed |

## Fixed in this pass
1. **Archive reader crash.**
   - **What happened:** the 3 parallel readers all start a fresh usage row at the start of a new day. Two inserted the same `(day, model)` row at once, and both crashed with a duplicate-key error. This was the 21 Nov failure.
   - **Fix:** the row is now created in its own short transaction with "insert if missing".
   - **Check:** 3 concurrent sessions against a real Postgres reproduced the crash on the old code and ran cleanly on the new code.
2. **Database security warning: functions with a changeable `search_path` (4 trigger functions).**
   - The search path is now pinned to `public, pg_temp` in the code that creates them.
   - It was also applied on the live database with `ALTER FUNCTION`. No data was changed.
3. **Dead code left over from the redesigns, now removed:**
   - components: `RingGauge`, `TrendChart`, `Drawer`, `RadarSweep`, the unused viz components (`KpiOrb`, `PulseRing`, `MoodGlyph`, `HeroStage`, viz `Sparkline` and `Delta`);
   - the streamgraph maths (`smooth`, `riverLayers`, `bandPath`) and its tests;
   - unused helpers in `TimeBrush`, and `lastSyncAt`;
   - CSS for the starburst, word cloud, radar sweep, pin drop, flow-in, aurora, hero stage and drawer.
4. **GitHub Actions:** `actions/cache@v4` (Node 20, deprecated) → `@v5` in the archive-reader workflow, matching the sync workflow.
5. **Flaky UI-audit check:** the scatter-dots step now waits for the chart to settle before counting.

## Left as is (on purpose)
- **"RLS enabled, no policy" on 44 tables (INFO):** intended. The site and workers use a direct database connection, and the public Supabase API should see nothing.
- **Extensions `vector` and `pg_trgm` in the `public` schema (WARN):** moving them would rebuild the search indexes for little benefit on a private database.
- **4 "unused" indexes (INFO):** the two trigram indexes serve comment search, which is rare, so the counters show zero. They are left in place.
- **`share_links` foreign key without an index (INFO):** the table has a handful of rows.
- **Usage counters under parallel load:** when the 3 archive readers bump the same model's request counter at the same moment, one bump can overwrite another. Daily counts can then read slightly low; this is not a crash. It could be made exact with an atomic `requests = requests + 1` update.
- **Old pull request [GuhanathanG/Youtube-Analytics#21](https://github.com/GuhanathanG/Youtube-Analytics/pull/21)** ("Install and configure Vercel Web Analytics", opened by Vercel on 6 Nov): still open and unmerged. Merge or close it.
- **Packages with newer major versions** (`typescript` 7, `postgres` 4, `web-push` 4, `@types/node`): no security reason to move. Upgrade deliberately, with testing.

## Needs your decision
- **`cron.job_run_details` keeps growing.**
  - The `reap-stuck-pooler-connections` job runs every 15 seconds and logs every run: 72,391 rows (13 MB) in 13 days, all successful.
  - That is about 1 MB a day on a 500 MB free plan, forever.
  - **Suggested fix:** a daily clean-up that keeps the last 3 days. It deletes only old log rows, but it does delete, so it waits for your OK.
- **Change the Mumbai database password and `CRON_SECRET`** (reminder).
