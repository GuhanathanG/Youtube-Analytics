# Project plan

## Goal

A personal analysis platform to watch chosen YouTube (and, where possible, Instagram) creators closely:

- every comment, including past ones, new ones and replies
- multi-language sentiment
- AI-generated insights on top of the raw data

The whole platform must run on free tiers.

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Language | Python | One language for data fetching, AI models and the dashboard |
| Scheduler / worker | GitHub Actions (hourly cron) | Free, with nothing to keep running. The work is run, save, exit. |
| Database | Supabase Postgres (free, 500 MB) | Real Postgres, a web table viewer for non-coders, and pgvector for later AI search |
| Dashboard | Streamlit on Streamlit Community Cloud | Free hosting, Python-only, password-protected through secrets |
| Sentiment (phase 1) | `cardiffnlp/twitter-xlm-roberta-base-sentiment` on CPU | Free, multilingual (XLM-R covers 100 languages), runs inside Actions |
| Language detection | Unicode-script rules, then Tanglish/Hinglish marker words, then `langdetect` | Works for short comments and romanized Indian languages |
| AI layer (phase 2) | Google Gemini free tier first, then Groq free tier, via their OpenAI-compatible APIs | Best free multilingual quality; when one model's daily limit is used up, the next takes over |
| Minutes budget | `budget.py` plans each run from the minutes left this month | Keeps a private repo within 2,000 free GitHub minutes |

### How the sync stays within the free YouTube quota

- Comments are read 100 per API unit, newest first. The page position is saved after every page, so the history download continues across runs and across days.
- On every run, each video's `commentCount` is compared with the last value checked. Only videos whose count went up are read again, and only until a comment we already have is reached. A quiet video costs 0 units.
- Stats for recent videos are refreshed on every run; older videos are refreshed once a day, at 50 videos per unit.
- A daily budget (`DAILY_QUOTA`, default 9,500 of 10,000) is tracked in the `quota_usage` table. When it runs out, the run stops cleanly and the next day continues.

## Roadmap

### Phase 1: Foundation and YouTube (this commit)
- [x] Track channels by @handle, channel URL or video URL, added from the dashboard
- [x] Full upload history, with new uploads detected every hour
- [x] Full comment history, including all replies, resumable
- [x] Hourly pickup of new comments
- [x] Channel and video stats snapshots (growth charts)
- [x] Language detection (script-based, plus Tanglish and Hinglish)
- [x] Multilingual sentiment on every comment
- [x] Dashboard: overview, channel, video, comment explorer, CSV export, manage channels
- [x] Tests on SQLite and PostgreSQL

### Phase 2: The AI layer (this commit)
- [x] Free AI with automatic fallback (Gemini models first, then Groq) and per-model daily usage tracking
- [x] AI reads every comment, in this priority order:
  - romanized (Tanglish/Hinglish) comments
  - comments the local model was unsure about
  - the newest comments

  For each comment it gives:
  - sentiment, understanding sarcasm and slang
  - one of 16 emotions
  - flags for question, request, spam and toxic
  - aspects with polarity (audio, editing, host, ads, …)
  - corrected language
  - an English translation
- [x] AI insights per video (refreshed when comments grow by 25% and at least 20): summary, mood, liked, complaints, requests, questions, topics with share, and language notes
- [x] AI insights per channel (daily): summary, trend, audience profile, best and weakest videos, and content ideas
- [x] Dashboard additions:
  - insight panels
  - praise-vs-criticism chart by aspect
  - emotions chart
  - question and request tabs
  - emotion, type and spam filters
  - translations
  - free-tier usage panel
- [x] GitHub minutes planner for the private repo
- [ ] Topic clustering with multilingual embeddings (pgvector), for very large comment sets
- [ ] Alerts when a video's negative share jumps compared with the channel's normal level

### Phase 2.5: Creator Pulse website (this commit)
- [x] Next.js website in `web/`, deployed free on Vercel, reading the same Supabase database
- [x] Dark "mission control" design:
  - glass panels and animated numbers
  - ⌘K search across channels, videos and comments
  - live sync status
  - mobile bottom navigation
- [x] Pages:
  - overview with channel cards and the latest AI briefings
  - channel deep-dive
  - video page with the embedded player
  - comment explorer with CSV export
  - watchlist management with free-tier meters
- [x] Password sign-in, using a signed cookie that never contains the password
- [x] Supabase's public REST API is blocked by switching on Row Level Security for every table

### Phase 2.6: Live mode and website controls (this commit)
- [x] While the site is open, every 60 seconds it:
  - picks up new uploads (checked every 10 minutes)
  - refreshes stats for recent videos
  - reads new comments wherever a video's count went up
  - has the free AI (Gemini, then Groq) read them right away
- [x] One check at a time across all tabs and devices (a shared lock row in `live_state`), with the YouTube
  quota shared with the background job through `quota_usage`
- [x] "✦ N new comments" notifications, a live feed on the overview, and a Live / pause pill
- [x] Adding a channel looks it up straight away and loads its newest 50 videos and the newest comments of its 3 latest videos
- [x] "Run full sync now" on the Manage page, which starts the GitHub workflow through the API with a fine-grained token, and shows recent runs

### Phase 3: Ask your comments
- A chat box: "What do people dislike about this creator's last 5 videos?"
- Answers use semantic search over the stored comments and cite real comments.

### Phase 4: Instagram (with honest limits)
Meta's official API only gives full data, including comment text, for accounts you own or manage, and only for Business or Creator accounts.

For creators you don't own, the **Business Discovery** API gives:
- public profile stats (followers, number of posts)
- per-post like and comment **counts**

It does **not** give comment text. Scraping comment text breaks Meta's terms, and accounts or apps that do it get banned, so this project won't scrape.

Plan:
- **For creators you watch:** Business Discovery metrics, using your own Instagram Business account linked to a Facebook Page.
- **For your own accounts:** full comment download and sentiment, using the same pipeline as YouTube.

### Phase 5: Hardening
- A YouTube live-chat monitor for live streams.
- Re-checking replies on old comment threads.
- Archiving old data if the 500 MB database fills up.
- Usage reports and failure notifications.

## Known limitations (phase 1)
- New replies on *old* comment threads are only picked up when they appear in the first page of a video's newest comments.
- The local sentiment model is weaker on romanized and code-mixed text and on sarcasm. Phase 2 addresses this.
- The YouTube API does not provide watch time, retention or demographics for channels you don't own. Only public stats are available.
