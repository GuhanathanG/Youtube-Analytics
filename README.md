# Creator Analytics · Creator Pulse

A personal dashboard for **watching YouTube channels and creators closely**. It:

- downloads **every comment**, including past comments, new comments and replies, for each channel you track
- checks for **new comments every 2 hours** (every hour once the repository is public)
- detects each comment's **language**, including Tamil, Hindi, Telugu, Malayalam and other Indian languages, plus romanized Tamil (Tanglish) and romanized Hindi (Hinglish)
- labels each comment's **sentiment** (positive / neutral / negative) with a free multilingual model that runs on GitHub
- has a **free AI** (Google Gemini, with Groq as backup) read the comments closely. It:
  - understands Tanglish, Hinglish, slang and sarcasm
  - tags each comment's emotion
  - flags questions, requests and spam
  - notes what each comment is about (audio, editing, host, ads, …)
  - translates comments into English
- writes an **AI summary** for each video and channel: what viewers liked, complaints, requests, questions, topics and content ideas
- tracks **channel and video growth** (subscribers, views, likes) over time
- shows everything in a **web dashboard** you can open from your phone or laptop

It runs **entirely on free services**, so there are no servers for you to manage.

```
 GitHub Actions (free, every 2 hours)                  Streamlit Cloud (free)
 ┌───────────────────────────────────┐                ┌──────────────────────┐
 │ 1. sync    → YouTube Data API     │   Supabase     │  Dashboard you open  │
 │ 2. analyze → sentiment model      │──► Postgres ◄──│  in the browser      │
 │ 3. ai      → Gemini / Groq (free) │    (free)      │                      │
 └───────────────────────────────────┘                └──────────────────────┘
```

See [`docs/PLAN.md`](docs/PLAN.md) for the architecture and roadmap.

---

## One-time setup (about 30 minutes, no coding)

You will create 4–5 free accounts and copy their keys into GitHub and Streamlit.

### Step 1: Get a YouTube API key (Google Cloud)

1. Go to <https://console.cloud.google.com/> and sign in with your Google account.
2. At the top, click the project picker, then **New project**. Name it `creator-analytics` and click **Create**.
3. Open **APIs & Services → Library**, search for **YouTube Data API v3**, and click **Enable**.
4. Open **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
5. (Recommended) Click the key, then under **API restrictions** choose **Restrict key → YouTube Data API v3**, and click **Save**.

No billing account is needed. The free quota is 10,000 units a day, which is enough for hundreds of thousands of comments a day.

### Step 2: Create the database (Supabase)

1. Go to <https://supabase.com/>, sign up (GitHub login is fine), and click **New project**.
2. Choose a name and a **database password** (save it somewhere safe), and pick the region closest to you.
3. When the project is ready, click **Connect** at the top of the page.
4. Under **Connection string**, select the **Session pooler** option and copy the URI. It looks like:
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
5. Replace `[YOUR-PASSWORD]` with the password from step 2. This full string is your **`DATABASE_URL`**.

> Use the **Session pooler** string, not the "Direct connection" one. GitHub's servers can't reach the direct address.

The tables are created automatically on the first run. You can browse the raw data any time in Supabase → **Table editor**.

### Step 3: Get the free AI keys

**Google Gemini (main AI):**
1. Go to <https://aistudio.google.com/>, sign in with your Google account, and accept the terms.
2. Click **Get API key → Create API key**, and pick the `creator-analytics` project from step 1 (or let it create one).
3. Copy the key.

**OpenRouter (third free AI, optional):**
1. Go to <https://openrouter.ai/>, sign up, and open **Keys → Create Key**. No credit card needed.
2. Copy the key (it starts with `sk-or-`). Add it as `OPENROUTER_API_KEY` in GitHub Secrets **and** in Vercel.
   Free accounts get 50 requests a day across OpenRouter's `:free` models, which is about 1,250 extra comments a day.

**Mistral (recommended: the biggest free allowance, about 1 billion tokens a month):**
1. Go to <https://console.mistral.ai/>, sign up and verify your phone number. No credit card needed.
2. Choose the free **Experiment** plan when asked.
3. Open **API Keys → Create new key** and copy it.
4. Add it as `MISTRAL_API_KEY` in GitHub Secrets **and** in Vercel.
   On the free plan Mistral may use what you send to train its models; here that's only public YouTube comments.

**Cloudflare Workers AI (optional, about 4,000 comments a day):**
1. Sign up at <https://dash.cloudflare.com/> (free plan).
2. Copy your **Account ID** (on the right side of the account home page).
3. Go to **My Profile → API Tokens → Create Token**, use the **Workers AI** template, and copy the token.
4. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY` (the token) in GitHub Secrets **and** in Vercel.

**Groq (backup AI, used when Gemini's free daily limit runs out):**
1. Go to <https://console.groq.com/>, sign up, and open **API Keys → Create API Key**.
2. Copy the key.

Both are free and need no credit card.

> On free plans, Google may use what you send to improve its products. Here you only send **public** YouTube comments, so nothing private is shared.

### Step 4: Give GitHub the secrets

1. In this repository on GitHub, go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret** for each of these:
   - Name `YOUTUBE_API_KEY`, value: the key from step 1
   - Name `DATABASE_URL`, value: the string from step 2
   - Name `GEMINI_API_KEY`, value: the Gemini key from step 3
   - Name `GROQ_API_KEY`, value: the Groq key from step 3
   - Optional, same way: `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID`
3. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.

> GitHub only runs scheduled (hourly) workflows from the repository's **default branch** (`main`). Make sure this code is merged into `main`.

### Step 5: Put the dashboard online (Streamlit Community Cloud)

1. Go to <https://share.streamlit.io/> and sign in with GitHub.
2. Click **Create app → Deploy a public app from GitHub**, choose this repository, branch `main`, and main file `streamlit_app.py`.
3. Click **Advanced settings**:
   - Python version: **3.12**
   - Secrets: paste the following, with your own values:
     ```toml
     DATABASE_URL = "postgresql://postgres.abcdefgh:YOUR-PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
     APP_PASSWORD = "pick-a-password-for-the-dashboard"
     ```
4. Click **Deploy**. You'll get a link like `https://your-app.streamlit.app`. Bookmark it.

`APP_PASSWORD` keeps other people out of your dashboard even though the link is public.

### Step 5b: Put the Creator Pulse website online (Vercel) — recommended

The `web/` folder is a full website with the futuristic dark interface: ⌘K search, AI briefings,
animated charts, comment explorer and watchlist management. It works on phones too. It reads the
same database, so the Streamlit dashboard from Step 5 can stay as a backup or be deleted.

1. Go to <https://vercel.com/signup> and choose **Continue with GitHub** (free **Hobby** plan).
2. Click **Add New… → Project** and find **Youtube-Analytics**.
   - If it isn't listed, click **Adjust GitHub App Permissions**, give Vercel access to this repository, and come back.
   - Click **Import**.
3. On the configure screen:
   - **Root Directory:** click **Edit**, choose **`web`**, and click **Continue**. This is the most important setting.
   - **Framework Preset:** Next.js (picked automatically).
   - Open **Environment Variables** and add two:
     - `DATABASE_URL`: your Supabase address, with one change: use port **`6543`** instead of `5432` (the
       **Transaction pooler**, which suits websites better). For example:
       `postgresql://postgres.xxxx:YOUR-PASSWORD@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`
     - `APP_PASSWORD`: the password for opening the website (it can be the same as the Streamlit one).
4. Click **Deploy**. After about a minute you get a link like `https://youtube-analytics-xxxx.vercel.app`. Open it and sign in.

Every change merged into `main` redeploys the site automatically.

#### Turn on live mode and the website controls

Live mode checks YouTube for new comments **every minute while the website is open**. The AI reads
new comments straight away, and the page updates itself with a "✦ 12 new comments" notice. Adding a
channel loads its newest videos and comments within seconds. The background job still downloads
the full history every 2 hours.

In Vercel, open your project → **Settings → Environment Variables** and add these (the same values as your GitHub secrets):

| Key | Value | What it turns on |
|---|---|---|
| `YOUTUBE_API_KEY` | your YouTube key | Live mode, and adding channels instantly |
| `GEMINI_API_KEY` | your Gemini key | The AI reads new comments live |
| `GROQ_API_KEY` | your Groq key | Backup AI |
| `GITHUB_TOKEN` | see below (optional) | The **Run full sync now** button on the Manage page |

To create `GITHUB_TOKEN`:
1. Open <https://github.com/settings/personal-access-tokens/new> (a fine-grained token).
2. **Name:** `creator-pulse`.
   **Expiration:** 1 year (or your choice).
3. **Repository access:** *Only select repositories* → **Youtube-Analytics**.
4. **Permissions → Repository permissions → Actions:** *Read and write*. Leave everything else as it is.
5. Click **Generate token** and copy it (it starts with `github_pat_`).

After adding the variables, go to **Deployments → ⋯ → Redeploy** so the site picks them up.

#### Run the engine 24/7, even with the website closed (free timer)

Vercel's free plan only allows its own scheduler once a day. So a free outside service,
**cron-job.org**, calls your website's engine every 2 minutes.

1. In Vercel, open **youtube-analytics-web → Settings → Environment Variables**. Add `CRON_SECRET` with any
   long random text (at least 16 characters; letters, numbers, `-` and `_` only). Then **Redeploy**.
2. Sign up free at <https://cron-job.org> and click **Create cronjob**:
   - **URL:** `https://<your-site>.vercel.app/api/cron?key=<your CRON_SECRET>`
   - **Execution schedule:** every **2** minutes
   - Under **Advanced**, set **Timeout** to the longest allowed (30 s is fine; the engine keeps working after the timer disconnects).
   - Click **Create**.
3. Within a few minutes, the website's **Manage → Engine** panel turns cyan and says **Running 24/7**.

**Keep it every 2 minutes, not every minute.** Vercel's free plan includes 360 GB-hours of function memory a month,
and the project stops serving until next month if any free limit is passed (there's no pay-as-you-go on Hobby).
A run every 2 minutes, capped at about 22 s (`ENGINE_BUDGET_SECONDS`), uses roughly 250–300 GB-hours a month.
Every minute would need about twice that. Check **Vercel → your project → Usage** after a few days. If
"Provisioned Memory" is heading past 300 GB-hours for the month, change the cron-job.org schedule to every 3 minutes.

Each engine run picks up new uploads and comments, downloads comment history, has the AI read new comments
and work through the backlog, and writes AI briefings. Vercel also calls the engine once a day as a backup.
The GitHub job (every 2 hours) still runs the local sentiment model on the history.

#### Advanced video analysis (free)

Each video page shows:
- performance compared with the channel (views, like rate, comment rate, a community **dislike estimate**);
- **what happens in the video**: Gemini watches public videos (pictures and sound) and gives a summary, chapters, key moments, how strong the hook is, production notes, sponsors, strengths and weaknesses;
- the **most-discussed moments**, from timestamps viewers write in comments.

Shares, watch time and retention are owner-only on YouTube, so they can't be shown.

Gemini watches up to about 8 hours of YouTube video a day for free; the app keeps under 7 hours. To have **new uploads analysed
automatically**, add a second cron-job.org job:
- **URL:** `https://<your-site>.vercel.app/api/video-analysis?key=<your CRON_SECRET>`
- **Schedule:** every **2 hours**
- **Timeout:** the longest allowed

Each run can take 1–3 minutes, and every 2 hours keeps it well inside Vercel's free memory allowance.
Any video can also be analysed by hand with **Analyse this video with AI** on its page.

#### Alerts on Telegram (free, optional)

Alerts always show on the Overview page. To also get them on your phone:
1. In Telegram, open **@BotFather**, send `/newbot`, and pick a name. Copy the **token** it gives you.
2. Send any message to your new bot. Then open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser
   and copy the number after `"chat":{"id":`. That's your **chat id**.
3. In Vercel, add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, plus `SITE_URL` (your site's address, so alerts link back to it). Then **Redeploy**.
4. On **Manage → Alerts on Telegram**, click **Send a test message**.

You get alerts for new uploads, sudden jumps in negative comments on a recent video, and comments that go viral.

Live mode and the background job share YouTube's free 10,000 units a day. A minute of live mode costs
about 1–3 units, so leaving the site open all day uses roughly 1,500–4,000 units. You can pause live mode
from the **Live** pill at the top right.

### Step 6: Add channels and start

1. Open your dashboard and go to **Manage channels**.
2. Paste a creator's `@handle`, channel URL, or any of their video URLs, then click **Add channel**. Repeat for each creator.
3. In GitHub, go to **Actions → Sync & analyze → Run workflow** to start right away, or wait for the next scheduled run (every 2 hours).
4. To confirm the AI keys work, open that run and look at the **AI deep analysis** step. Each free model shows as *OK*, or with the reason it can't be used (for example "API key rejected").

The first run downloads each channel's video list and starts on past comments, beginning with the newest video. Large channels take several runs (hours to a few days) to get through their full history. Progress is shown on the **Overview** page, and nothing is lost between runs.

---

## Using the dashboard

| Page | What you get |
|---|---|
| **Overview** | Totals, every channel side by side, sentiment over time, and sentiment mix by channel |
| **Channel deep-dive** | AI insights (summary, trend, audience, best and weakest videos, content ideas), what viewers praise and criticise, emotions, growth, comment languages, and every video with its sentiment |
| **Video deep-dive** | AI summary, topics, praise and criticism, emotions, and tabs for most liked, positive, negative, questions and requests |
| **Comment explorer** | Filter by channel, video, sentiment, emotion, type (question/request/spam), language or keyword; see the English translation; download as CSV |
| **Analytics** | **Channel health score** (0–100 from growth, engagement, mood, loyalty, consistency, momentum). **Video performance:** outlier score (views vs the channel's usual for the same format), breakout videos and underperformers, Shorts vs long videos, first-24-hour growth. **Best time and format:** upload day/time heatmap, title styles and words that work, video length. **Audience:** new vs returning commenters, loyal viewers, creator reply rate, languages over time. **Topics:** comments grouped into themes automatically, with mood and rising/falling trends. **Thumbnails:** the AI checks every thumbnail (faces, text, colours, readability) and shows which styles do best. **Brands & sponsors** named in videos, with viewer mood |
| **Ideas** | Content ideas grouped by the AI, plus the most-liked **unanswered viewer questions** (no reply from the creator), by topic |
| **Weekly report** | A one-page report per channel (channel page → "Weekly report / PDF"; use "Save as PDF"). Every Monday morning (India time) a summary arrives on Telegram and as a phone notification |
| **Share links** | Manage → "Share a read-only report": a link that opens one channel's report without your password. Links can expire and can be turned off |
| **Live chat** | While a watched creator is live (stream or premiere), the chat is read every 2 minutes: messages per minute, Super Chats, questions, top chatters, mood, and an AI summary when the stream ends. YouTube offers no chat replay to apps, so only live chat is captured (5 quota units per read) |
| **Phone app** | Android: ⋮ → Install app. iPhone: Share → Add to Home Screen. Then Manage → "Turn on notifications" to get alerts and the weekly report on your phone. Nothing to set up: the notification keys are created automatically |
| **Manage channels** | Add, pause or resume channels; free-tier usage (GitHub minutes, YouTube quota, AI models); recent runs |

**Sentiment score** runs from −100 (every comment negative) to +100 (every comment positive). It is the average of each comment's positive probability minus its negative probability.

---

## Instagram (via Apify)

Watch Instagram accounts next to YouTube channels. Needs `APIFY_TOKEN` in Vercel (free Apify plan: $5 of credit a month).

1. **Manage → Watch an Instagram account**: type `@username` (or paste the profile link; an `instagram.com/…` link in the normal channel box works too).
2. Within 1–3 minutes the profile (followers, bio), the latest 50 posts and their likes/comment counts appear. Comments follow on the next engine runs, and the AI reads them like YouTube comments, so briefings, Creator Memory, Ask AI, commenter pages and analytics include Instagram.
3. After that the engine refreshes each account's profile + newest 12 posts every 12 hours, and fetches comments every 6 hours for posts whose comment count went up (newest posts first).

**Spending is capped.** Every Apify run has a hard limit (`maxItems` and `maxTotalChargeUsd`). The month's budget (`IG_MONTHLY_USD`, default $4.50) is spread evenly over the days left in the month, and nothing starts once today's share is spent. Manage → Instagram budget shows what was spent and the latest runs.

Limits of the free Apify plan: about 15 comments per post are returned, and Instagram image links expire after a few days (the newest posts' images refresh every 12 hours). Private accounts can't be read. Settings: `IG_PROFILE_HOURS` (12), `IG_COMMENT_HOURS` (6), `IG_POSTS_PER_RUN` (8), `IG_COMMENTS_PER_POST` (50), `IG_HISTORY_POSTS` (50), `IG_PRICE_PER_RESULT` (0.0027).

## Comment archive (free Neon database, when Supabase fills up)

Supabase's free database holds about 1 million comments (500 MB). The background job can move **old comments the AI has already read** to a second free database, so downloads never stop:

- **What moves:** comments older than 180 days that the local model and the AI have read.
- **What stays:** questions, requests and comments with 25 or more likes.
- **Counts:** each channel's per-day counts are kept in the main database, so totals and charts stay correct.
- **AI understanding:** it's kept in Creator Memory.
- **Search, Ask AI, CSV export and commenter pages** also look in the archive.
- **When it runs:** only when the main database is over 70% full (`ARCHIVE_AT_PERCENT`).

Setup (about 5 minutes):
1. Sign up at <https://neon.tech> (free plan, no card).
2. Create a project and pick the region closest to the main database (now Mumbai, ap-south-1): **AWS Asia Pacific (Mumbai)** if offered, else Singapore.
3. On the project dashboard click **Connect**, choose **Pooled connection**, and copy the connection string. It starts with `postgresql://` and ends with `?sslmode=require`.
4. Add it as `ARCHIVE_DATABASE_URL` in **GitHub Secrets** (the background job moves comments) **and in Vercel** (the website reads the archive). Then redeploy in Vercel.

Neon's free plan (as checked earlier) gives about 1 GB per project, roughly 2 million more comments; check your Neon dashboard for the current limit. When it fills up, create another project and swap the address.

## Free-tier limits

| Service | Free limit | What it means here |
|---|---|---|
| YouTube Data API | 10,000 units/day | One unit reads 100 comments. The app stops at 9,500 and continues the next day (resets at midnight US Pacific time). |
| Supabase | 500 MB database | Roughly 1 million comments. Projects pause after 7 days with no activity; the hourly sync keeps yours active. |
| GitHub Actions | **Private repo: 2,000 min/month.** Public repo: unlimited | See the note below. |
| Streamlit Cloud | Free | The app sleeps when nobody visits for a while. Click "wake up" and it's back in about 30 seconds. |

**GitHub minutes (private repositories only):** a private repository gets 2,000 free minutes a month. Every run records how long it took, and the next run divides the minutes left by the runs left this month. Quiet runs finish early and save time for busy ones, so the month never runs out. While a big channel's history is still downloading, it simply takes more runs.

**This repository is public**, so GitHub minutes are unlimited: the background job runs every 30 minutes and half of each run is an "AI lane" for big batches. If you ever make it private again, edit `.github/workflows/sync.yml` **first**:
- change `"7,37 * * * *"` to `"7 */2 * * *"` (every 2 hours)
- set `RUNS_PER_DAY: "12"`, `MONTHLY_MINUTES_BUDGET: "1700"` and `MAX_WORK_MINUTES: "25"`

**Free AI limits:** each free AI service allows a set number of requests per day, and the exact numbers depend on your account. To make them go further:
- **Short reactions skip the AI.** "first!", "❤️🔥", "semma bro" and the like are labelled by simple rules (`ytanalytics/quick_labels.py`, `web/lib/quick-labels.ts`). Anything with a word the rules don't know still goes to the AI.
- **Big batches.** The background job sends 100 comments per request (`AI_BATCH_SIZE`) and the website 50 (`AI_BATCH`).
- **Most important first:** comments from the last 2 days, then the most liked and longest, then Tanglish/Hinglish and ones the local model was unsure about.
- **Gemini models are discovered,** not hard-coded: the app asks Google which models your key can use.
- **Free local AI on GitHub** (no limit): a multilingual emotion model, question/request patterns, and a topic grouping model run inside the background job. The online AI later replaces these labels with richer ones. When every model's daily limit is used up, the AI step stops and continues after midnight US Pacific time. You can see today's AI usage under **Manage channels → Free-tier usage**.

---

## Settings you can change

These are optional environment variables. Add them in the workflow file `.github/workflows/sync.yml` under `env:`.

| Name | Default | Meaning |
|---|---|---|
| `DAILY_QUOTA` | `9500` | Max YouTube units to spend per day |
| `LIVE_WINDOW_DAYS` | `14` | Videos newer than this get their stats refreshed on every run (older videos once a day) |
| `FETCH_ALL_REPLIES` | `true` | Download every reply, not just the first 5 per comment |
| `SENTIMENT_MODEL` | `cardiffnlp/twitter-xlm-roberta-base-sentiment` | Any Hugging Face 3-class sentiment model |
| `GEMINI_MODELS` | `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-2.5-flash,gemini-2.5-flash-lite` | Gemini models to try, in order |
| `GROQ_MODELS` | `openai/gpt-oss-120b,openai/gpt-oss-20b` | Groq models to try, in order |
| `GEMINI_DAILY_REQUESTS` / `GROQ_DAILY_REQUESTS` | `200` / `900` | The app's own cap per model per day, kept below the free limit |
| `AI_BATCH_SIZE` | `40` | Comments per AI request |
| `AI_INSIGHTS_PER_RUN` | `5` | Video summaries written per run |
| `MONTHLY_MINUTES_BUDGET` | `1700` | GitHub minutes the app may use per month (`0` = no limit) |

## For developers

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q                       # tests use SQLite and a fake YouTube API
TEST_DATABASE_URL=postgresql://... python -m pytest -q   # same tests on Postgres

export DATABASE_URL=sqlite:///ytanalytics.db YOUTUBE_API_KEY=...
python -m ytanalytics add-channel "@SomeCreator"
python -m ytanalytics sync
pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install -r requirements-ai.txt
python -m ytanalytics analyze
export GEMINI_API_KEY=... GROQ_API_KEY=...
python -m ytanalytics ai-check   # which free models work with your keys
python -m ytanalytics ai
streamlit run streamlit_app.py
```

Code layout:

- `ytanalytics/youtube.py`: API client, quota tracking, and parsing of @handles and URLs
- `ytanalytics/sync.py`: history download and new-comment pickup
- `ytanalytics/sentiment.py`: language detection and the multilingual sentiment model
- `ytanalytics/llm.py`: free AI models (Gemini, Groq), automatic fallback and daily usage limits
- `ytanalytics/ai.py`: AI labels per comment, plus video and channel insights
- `ytanalytics/budget.py`: keeps GitHub Actions within the free monthly minutes
- `ytanalytics/db.py`: database tables
- `ytanalytics/queries.py`: dashboard queries
- `streamlit_app.py`: the original Streamlit dashboard
- `web/`: the Creator Pulse website (Next.js, deployed on Vercel). Run locally with
  `cd web && npm install && DATABASE_URL=... APP_PASSWORD=... npm run dev`
