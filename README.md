# Creator Analytics

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
| **Manage channels** | Add, pause or resume channels; free-tier usage (GitHub minutes, YouTube quota, AI models); recent runs |

**Sentiment score** runs from −100 (every comment negative) to +100 (every comment positive). It is the average of each comment's positive probability minus its negative probability.

---

## Free-tier limits

| Service | Free limit | What it means here |
|---|---|---|
| YouTube Data API | 10,000 units/day | One unit reads 100 comments. The app stops at 9,500 and continues the next day (resets at midnight US Pacific time). |
| Supabase | 500 MB database | Roughly 1 million comments. Projects pause after 7 days with no activity; the hourly sync keeps yours active. |
| GitHub Actions | **Private repo: 2,000 min/month.** Public repo: unlimited | See the note below. |
| Streamlit Cloud | Free | The app sleeps when nobody visits for a while. Click "wake up" and it's back in about 30 seconds. |

**GitHub minutes:** this repository is **private**, so GitHub gives 2,000 free minutes a month. Every run records how long it took, and the next run divides the minutes left by the runs left this month. Quiet runs finish early and save time for busy ones, so the month never runs out. While a big channel's history is still downloading, it simply takes more runs.

**When you make the repository public**, minutes become unlimited. Edit `.github/workflows/sync.yml`:
- change `"7 */2 * * *"` to `"7 * * * *"` (every hour)
- set `RUNS_PER_DAY: "24"`
- set `MONTHLY_MINUTES_BUDGET: "0"` (no limit)

**Free AI limits:** Gemini and Groq each allow a set number of requests per day, and the exact numbers depend on your account. The app sends about 40 comments per request. It spends the AI on the comments that matter most first: Tanglish/Hinglish, uncertain comments and new comments. When every model's daily limit is used up, the AI step stops and continues after midnight US Pacific time. You can see today's AI usage under **Manage channels → Free-tier usage**.

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
- `streamlit_app.py`: the dashboard
