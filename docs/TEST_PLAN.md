# One-month live test as the customer (28 Nov – 27 Dec 2026)

**Goal:** for 30 days Claude acts as Creator Pulse's target customer: it uses every feature on the live site every
day, checks that what the site says is **true** (against YouTube, the comments themselves and what actually happened
later) and **useful** (would the customer act on it?). It also keeps the models training and runs the technical checks.
The month ends with evidence-based insights and a recommendation for the project.

The secrets stay unchanged until 27 Dec, then are rotated (`docs/SECURITY_ROTATION.md`).

---

## 1. The customer (who Claude plays)

**Primary: "Kavya", a Tamil creator.** Based on the channels the site tracks (Keerthi Shrathah, Deepika Venkatachalam,
Ram With Jaanu).
- Runs a YouTube channel with 100K–1M subscribers, plus its Instagram. Posts 2–3 long videos a week, plus Shorts and
  Reels. The audience comments in Tamil, Tanglish and English.
- No analyst. Checks things on her **iPhone** in the morning and before and after uploads, and plans on a laptop on
  Sundays.
- **What she wants to know:**
  1. Did my last video work, and why?
  2. What are viewers saying, and what do they want next?
  3. What should I make next, and how should I title it?
  4. What's working for others in my niche?
  5. Am I growing toward my goals?
- **She stops trusting a tool when:** the numbers don't match YouTube, the advice is generic, Tanglish is misread, or
  pages are slow or broken on her phone.

**Secondary: "Arun", her manager/editor.** Looks after the three channels on a desktop. Wants weekly reports, rival
comparisons and a shareable report for brand deals.

Every day's notes say which persona was played and whether they would have **acted** on what they saw.

---

## 2. A day in the customer's life (done every day, on the live site)

| Time (India) | As Kavya on the iPhone, or Arun on the desktop | Features used |
|---|---|---|
| Morning | "What happened overnight?" | Glance (phone), Overview, alerts, live comment ticker |
| Morning | "How did my newest upload do?" | Video page (first hours, mood, top comments, insight), Predict for that video |
| Midday | "What are people saying? What should I reply to?" | Comments (filters: questions, requests, negative; search in Tanglish), commenter pages, Ask AI |
| Afternoon | "What do I make next?" | Next moves, Ideas, Studio (an idea → titles, thumbnail brief, hook), Packaging Lab title score |
| Afternoon | "What's working around me?" | Outliers, Radar, Keywords, Compare |
| Evening | "Is Instagram keeping up?" | Instagram channel pages, YT vs IG |
| Sunday | "How was my week, and what's the plan?" | Weekly report, Growth & goals, report page and share link, Model Lab |

On top of this, each weekday has a **deep dive** where every option of one area is tried:

| Day | Deep dive (every control, filter and option of that area) |
|---|---|
| Mon | **Pulse:** Overview, all channels and focus, Next moves (every move checked), Glance, alerts |
| Tue | **Audience:** Comments (every filter, sort, language, search terms in Tamil, Tanglish and English, CSV), commenter pages, Ask AI (example questions and one new question) |
| Wed | **Performance:** Analytics (every section and chart type, timeline slider, range), Predict (forecasts and the draft tester), Growth & goals |
| Thu | **Create:** Studio (an idea end to end), Ideas, Packaging Lab (5 real title variants scored) |
| Fri | **Market:** Outliers (period and threshold filters), Keywords (3 real searches), Radar, Compare (two channels) |
| Sat | **Platforms:** Instagram channels, YT vs IG, report pages, share link (opened in a signed-out window), Glance as a home-screen app |
| Sun | **Models and the week:** Model Lab (models, score history, training channels, live view) and the weekly summary |

**How the actions are done:** the morning live check (`web/tests/prod-check.mjs`) signs in as the customer and
does the day's actions on the real site:
- a comment search, with a different Tamil, Tanglish or English term each day;
- the 3 newest video pages;
- Predict for a draft title;
- the Packaging Lab scoring the channel's last 5 real titles;
- one Ask AI question from the customer's list;
- on Thursdays, a Studio plan from the top audience request.

It saves what the site answered (`scenario.json`) and screenshots. Claude then judges every answer for truth and
usefulness against the database, YouTube and the comments. Settings are never changed, and nothing is deleted.
Like normal use, the Ask AI conversation (one a day) and the Thursday Studio draft are saved on the site. That stays
inside the free AI allowance.

---

## 3. Accuracy: how each answer is checked

| Feature | What the site claims | How Claude checks it's true |
|---|---|---|
| Channel and video numbers | subscribers, views, likes, comments | **Automatic every morning** (`accuracy-check`): live YouTube numbers versus the dashboard's. More than 3% off on subscribers, or more than 25% on views with stats over 6 h old, is a problem. |
| New uploads | every new video appears | **Automatic:** each channel's public RSS feed versus the database. Any upload missed for more than 1 h is a problem. |
| Comments collected | all comments are there | **Automatic:** collected (including archived) versus YouTube's own comment count. Under 80% on a video over 6 h old is a problem. |
| Comment mood, emotion, questions, requests, spam | labels on each comment | 10 recent comments a day, read by Claude and marked right or wrong. Tamil and Tanglish are always included. Target ≥ 85% right. |
| Video and channel insights | "viewers liked X, complained about Y" | Read the insight, then the comments it summarises. Is each claim backed by real comments? Is anything big missing? Score 0–5. |
| Ask AI answers | an answer with cited comments | Open the cited comments. Do they say what the answer claims? |
| Next moves | specific actions with evidence | Is the evidence true (check the numbers)? Is the move specific to this channel, or generic? Would Kavya do it? |
| Forecasts (Predict) | 30-day views, range, vs normal | Forecasts are noted on day 1 of each video and compared with the real views when the video is 7 days old and 30 days old. Hit rate within 2× and inside the range. |
| Packaging Lab title score | a score versus the channel's own winners | Do higher-scored titles of past videos really have higher views? Checked on the channel's last 20 videos. |
| Outliers and Radar | "this video is 5× normal" | Recompute the multiple from the channel's recent median views. Is the rival list real and current? |
| Keywords | search demand scores | Plausible, and compared with the related searches the site shows. Marked "can't verify" where no source exists. |
| Growth and goals | pace and expected date | Recompute from the subscriber history. |
| Instagram | followers, posts, reel numbers | Freshness (when last fetched, which source) and agreement between sources. Exact public counts are checked once a week. |
| Weekly report and report page | week's numbers and highlights | Recompute 3 numbers from the database. |
| Model Lab | scores, adopted or not | Agrees with `model_runs` and the workflow logs. |

---

## 4. Technical checks (automatic, read every day)

- **Live site check** (`prod-check.yml`, 09:17 India time):
  - every page for the real channels, on desktop and iPhone;
  - HTTP status, load time, JavaScript errors, error screens, sideways scroll on the phone;
  - a screenshot of every page.

  Claude looks at the failed pages' screenshots and at 3+ others a day, for problems no script catches: wrong numbers,
  empty charts, unreadable text, odd layout.
- **Jobs:** every workflow's runs in the last 24 h, plus watchdog alerts. Website runtime errors from Vercel.
- **Capacity:** database sizes (main limit 500 MB, Neon about 1 GB each), YouTube quota used, AI providers that ran
  out, Kaggle GPU hours.
- **Models:** new score-history rows. Pulse Reader mood F1 and coverage. Creator Model versus the simple guess, and
  which feature set won. Pulse Analyst retrains and own-writer insights. Early-signal coverage (training videos with
  6 h and 24 h snapshots). Live forecast grading.

---

## 5. Scores tracked (daily, with weekly trends)

| Area | Measure | Good |
|---|---|---|
| Trust | dashboard numbers matching YouTube (accuracy check) | no problems on ≥ 27 of 30 days |
| Trust | uploads caught within 1 h | 100% |
| Comment reading | spot-check labels right (Tamil, Tanglish, English) | ≥ 85% |
| Insights | claims backed by comments | average ≥ 4 out of 5 |
| Ask AI | answers backed by their citations | ≥ 90% |
| Next moves | moves Kavya would act on | ≥ 1 per channel per week |
| Forecasts | within 2× at 30 days (live graded) | better than the simple guess |
| Reliability | live site checks passing | ≥ 98% |
| Reliability | scheduled runs succeeding | ≥ 95%, nothing down > 12 h |
| Speed | median page load | < 4 s (phone too) |
| Models | Reader F1, Creator gap over the guess, Analyst overlap | rising or steady |
| Cost | money spent | ₹0 |

---

## 6. Every day's output

1. **Log entry** in `docs/test-log/TEST_LOG.md`, covering:
   - persona and scenario;
   - feature-by-feature verdict: ✅ right and useful / ⚠️ right but not useful / ❌ wrong or broken;
   - accuracy numbers, technical status and fixes;
   - **one customer insight** (something Kavya or Arun would care about).
2. **Fixes:** small, clear bugs are fixed the same day in a PR, merged only on green CI. Bigger changes go in the
   weekly summary as proposals; nothing big is built unasked.
3. **A short note** in the Claude session.

**Weekly summary (Sundays):**
- trust and accuracy scores;
- most useful and least useful features, judged as the customer;
- model trends and reliability;
- fixes made, and decisions needed from the owner.

**Final report (27 Dec):**
- which features the customer would use every day, weekly, or never;
- how accurate it was, feature by feature, over 30 days;
- whether the models improved (score history and live forecast grading);
- reliability, speed and cost;
- bugs found and fixed;
- the recommendation: keep it personal / grow it into a product for Tamil creators / slim it down, with the
  evidence.

After that the daily task stops by itself, and it's time to rotate the secrets.

---

## 7. Rules
- **Like a customer, never like an admin:** no settings changed, nothing deleted, no channels added or removed. The
  only things saved are the daily Ask AI conversation and the Thursday Studio draft.
- **Free plans only:** anything that would cost money is proposed, not done.
- **Fixes:** only through pull requests with green tests. Database work is limited to safe maintenance, never
  deleting data.
- **Secrets:** never in logs, reports or commits. Claude never sees the site password: the live check reads it from
  the GitHub secret `SITE_PW`.
