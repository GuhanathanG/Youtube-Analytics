# Creator Analytics

A personal dashboard for **watching YouTube channels and creators closely**. It:

- downloads **every comment**, including past comments, new comments and replies, for each channel you track
- checks for **new comments every hour**
- detects each comment's **language**, including Tamil, Hindi, Telugu, Malayalam and other Indian languages, plus romanized Tamil (Tanglish) and romanized Hindi (Hinglish)
- labels each comment's **sentiment** (positive / neutral / negative) with a multilingual AI model
- tracks **channel and video growth** (subscribers, views, likes) over time
- shows everything in a **web dashboard** you can open from your phone or laptop

It runs **entirely on free services**, so there are no servers for you to manage.

```
 GitHub Actions (free, runs every hour)                Streamlit Cloud (free)
 ┌───────────────────────────────────┐                ┌──────────────────────┐
 │ 1. sync    → YouTube Data API     │   Supabase     │  Dashboard you open  │
 │ 2. analyze → AI sentiment model   │──► Postgres ◄──│  in the browser      │
 └───────────────────────────────────┘   (free)       └──────────────────────┘
```

See [`docs/PLAN.md`](docs/PLAN.md) for the architecture and roadmap.

---

## One-time setup (about 30 minutes, no coding)

You will create 3 free accounts and copy 3 values between them.

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

### Step 3: Give GitHub the two secrets

1. In this repository on GitHub, go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret** twice:
   - Name `YOUTUBE_API_KEY`, value: the key from step 1
   - Name `DATABASE_URL`, value: the string from step 2
3. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.

> GitHub only runs scheduled (hourly) workflows from the repository's **default branch** (`main`). Make sure this code is merged into `main`.

### Step 4: Put the dashboard online (Streamlit Community Cloud)

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

### Step 5: Add channels and start

1. Open your dashboard and go to **Manage channels**.
2. Paste a creator's `@handle`, channel URL, or any of their video URLs, then click **Add channel**. Repeat for each creator.
3. In GitHub, go to **Actions → Sync & analyze → Run workflow** to start right away, or wait for the hourly run.

The first run downloads each channel's video list and starts on past comments, beginning with the newest video. Large channels take several runs (hours to a few days) to get through their full history. Progress is shown on the **Overview** page, and nothing is lost between runs.

---

## Using the dashboard

| Page | What you get |
|---|---|
| **Overview** | Totals, every channel side by side, sentiment over time, and sentiment mix by channel |
| **Channel deep-dive** | Subscriber and view growth, sentiment trend, comment languages, and every video with % negative and a sentiment score |
| **Video deep-dive** | The video itself, when people commented, and the most liked, most positive and most negative comments |
| **Comment explorer** | Filter by channel, video, sentiment, language or keyword, sort, and download as CSV |
| **Manage channels** | Add, pause or resume channels, and see recent background runs |

**Sentiment score** runs from −100 (every comment negative) to +100 (every comment positive). It is the average of each comment's positive probability minus its negative probability.

---

## Free-tier limits

| Service | Free limit | What it means here |
|---|---|---|
| YouTube Data API | 10,000 units/day | One unit reads 100 comments. The app stops at 9,500 and continues the next day (resets at midnight US Pacific time). |
| Supabase | 500 MB database | Roughly 1 million comments. Projects pause after 7 days with no activity; the hourly sync keeps yours active. |
| GitHub Actions | **Private repo: 2,000 min/month.** Public repo: unlimited | See the note below. |
| Streamlit Cloud | Free | The app sleeps when nobody visits for a while. Click "wake up" and it's back in about 30 seconds. |

**GitHub minutes:** this repository is **private**. Hourly runs take about 1–3 minutes when things are quiet, but up to about 20 minutes while a large channel's history is still downloading. That can use up 2,000 minutes in a few days. You have two options:

- **Make the repository public** (Settings → General → Danger Zone → Change visibility). Minutes become unlimited. The code contains no passwords (those live in Secrets) and the data lives in Supabase, so nothing private is exposed.
- **Or** keep it private and run less often: edit `.github/workflows/sync.yml` and change `"7 * * * *"` to `"7 */3 * * *"` (every 3 hours).

If you run out, GitHub simply pauses the runs until next month. You are never charged unless you add a payment method.

---

## Settings you can change

These are optional environment variables. Add them in the workflow file `.github/workflows/sync.yml` under `env:`.

| Name | Default | Meaning |
|---|---|---|
| `DAILY_QUOTA` | `9500` | Max YouTube units to spend per day |
| `LIVE_WINDOW_DAYS` | `14` | Videos newer than this get their stats refreshed on every run (older videos once a day) |
| `FETCH_ALL_REPLIES` | `true` | Download every reply, not just the first 5 per comment |
| `SENTIMENT_MODEL` | `cardiffnlp/twitter-xlm-roberta-base-sentiment` | Any Hugging Face 3-class sentiment model |

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
streamlit run streamlit_app.py
```

Code layout:

- `ytanalytics/youtube.py`: API client, quota tracking, and parsing of @handles and URLs
- `ytanalytics/sync.py`: history download and new-comment pickup
- `ytanalytics/sentiment.py`: language detection and the multilingual sentiment model
- `ytanalytics/db.py`: database tables
- `ytanalytics/queries.py`: dashboard queries
- `streamlit_app.py`: the dashboard
