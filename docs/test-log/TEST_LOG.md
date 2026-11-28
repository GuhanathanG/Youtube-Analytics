# Test log (28 Nov – 27 Dec 2026)

One entry per day, newest at the bottom. Plan: `docs/TEST_PLAN.md`.

| Day | Date | Site checks | Jobs | Models | Problems found | Fixed | Insight of the day |
|---|---|---|---|---|---|---|---|
| 0 | 27 Nov | Live check built | All green | Reader 0.736 (best), Creator YT 60.8% vs 60.0% | — | — | Baseline recorded |
| 1 | Sat 28 Nov | 56/70 (median 4.9 s) | All green (sync 37/37) | Reader **0.742** (new best, adopted); Creator YT 59.7% vs 59.3% guess | Ask AI ignored "this week"; reel duration "0:94"; Instagram 403s; Analytics React #418; 2 video pages ~22 s | 6 small fixes (below) | Ask AI answered "this week" with a 2022 comment: a creator would act on stale news |

### Day 1 · Sat 28 Nov · Kavya (phone) + Arun (desktop) · deep dive: Platforms

**Accuracy against YouTube (automatic): no problems.** Subscribers match exactly (Keerthi 1.68M, Ram With Jaanu
2.49M). The 10 newest videos per channel are within 0.4% on views. Comments collected are 90–107% of YouTube's
count (above 100% because replies are counted too). No uploads missed.

| Feature | Verdict | Notes |
|---|---|---|
| Comment labels (10 spot-checked) | ✅ | Mood 10/10, including Tanglish ("Vera level look", "Super akka", "Akka nanum vicks sapduvanga"). Language 9/10: "Cute ka" was tagged Hinglish, but it's Tanglish. |
| Video insight ("Switching Lives…") | ✅ 4/5 | Part 2 requests, the home tour request, and the comedy and costume praise all match the top comments. It called Tanglish "Manglish" (fixed). |
| Ask AI ("complaints this week?") | ❌ | It quoted a 2022 and a September comment as "this week" (fixed: time words now filter by date, and dates are shown to the AI). |
| Video pages (3 Instagram reels) | ⚠️ | Numbers are right, but there are three different forecasts on one page (engine 639K vs trend 1.5M vs early "≈1.7M by day 7"). The engine forecast was **below the views it already had**. Instagram pages say "typical YouTube curve" and "YouTube doesn't provide". A reel showed a duration of "0:94" (fixed). |
| Predict | ✅ | Live record: 26/26 day-one forecasts landed within 2× at 30 days. There is an honest note that titles and timing explain little. |
| Comments explorer | ⚠️ | Works. Raw language codes ("en-Latn", "ml-Latn", "ro") are fixed to names. Duplicate channel names without a platform are fixed ("· YouTube" / "· Instagram"). |
| Instagram (deep dive) | ⚠️ | All 4 accounts synced within 2 h, no failures (ScrapeCreators). 403 errors on IG pages (thumbnails, probably expired Instagram image links): proposal. Only 124 of Keerthi's 1,365 posts are stored. |
| Packaging Lab | – | Not reached: the check used the wrong address (fixed). |
| Analytics | ⚠️ | React error #418 (server and browser render different text): proposal. |
| Speed | ⚠️ | Median 4.9 s (target < 4 s). Two YouTube video pages took 22 s on desktop: proposal. |

**Technical:**
- Jobs: sync 37/37, archive reading 4/4, training channels 4/4, Creator Model, Reader and Analyst all succeeded.
- No Vercel runtime errors. Main database 120 MB of 500. Quota 98 units today, 1,087 yesterday.
- Early signals: 38 of 66 training videos from the last 3 days have a 6-hour view count, and 49 have a 24-hour one.
- Live grading: 45 forecasts graded, 100% within 2×.

**Fixed today:**
1. Insight prompt: the audience is Tamil (Tanglish, not Manglish, Malayalam or Hindi).
2. Ask AI: understands "today / this week / this month / recently" and shows each comment's date to the AI.
3. Reel durations ("0:94" → "1:34").
4. Readable language names.
5. Platform in the channel filter.
6. Live check: Packaging Lab address, full-page screenshots, failed request addresses logged. The watchdog now covers the live check.

**Proposals (not done):**
- One clear forecast per video, never below the current views.
- Instagram-specific wording on Instagram pages.
- Re-fetch expired Instagram images.
- Analytics hydration error.
- Video page speed.

**Customer insight:** Kavya trusts the numbers: they match YouTube to the digit. But she would have acted on Ask AI's
"this week" answer and been wrong, so dates matter as much as accuracy.

