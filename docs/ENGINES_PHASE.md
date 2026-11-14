# Engines phase: audit, open-source research, plan

Goal: make every engine behind the site strong, fresh and self-healing, using free and open-source tools wherever we can.

## 1. Engine audit (live data, 14 Nov 2026)

| Engine | What it does | Health now | Weak spot |
|---|---|---|---|
| YouTube sync | videos, stats, comments | ✅ ~38 runs/day, all green; comments fetched minutes ago | Uses only **42–750 of 10,000** API units most days (one 5,662-unit day). Older videos' new comments and replies are rarely re-read. |
| Instagram | profile, posts, comments | ⚠️ profiles every 2 h, but **comments stalled for 2–3 days** | **Bug, fixed in this PR:** the profile refresh used every check's only turn, so comments never ran. |
| AI labelling | mood, emotion, intent, translation | ✅ 0 waiting; ~150/day on Gemini | Depends on free cloud quotas; the local models are older general ones (see §2.2). |
| Ask AI | answers from comments | ⚠️ 10–12 s per question | Fixed in PR #77: parallel lookups, text index, 3 s archive cap. |
| Video analysis | Gemini watches videos | ⚠️ failed on retired models + one busy model | Fixed in PR #77: current models, 5-model fallback. |
| Prediction | 30-day forecasts, drivers | ✅ nightly; 34 forecasts, 8 graded | Instagram model not trained yet (needs ~40 posts aged 7+ days). The model has no view-curve (time-series) features. |
| Archive | old comments in Neon | ✅ working | Search scans 1.1M rows (2.4 s), so Ask AI caps it. |
| Health alarm | Telegram when the engine stops | ⚠️ only checks "is the 2-minute engine running" | Didn't notice the Instagram comment stall. It needs a freshness check for each engine. |

## 2. Open-source / free options found

### 2.1 Data collection
- **YouTube comments without quota:** [youtube-comment-downloader](https://github.com/topics/youtube-comments) (MIT) and [ytscrape](https://github.com/vsmutok/ytscrape) read YouTube's internal InnerTube API, including all replies sorted newest first. They can break when YouTube changes its internal API, and YouTube can rate-limit heavy use ([Scrapfly roundup](https://scrapfly.io/blog/posts/best-open-source-youtube-scrapers)). **Use:** a fallback only. We have ~9,000 spare official units a day, which matter more.
- **YouTube transcripts:** [youtube-transcript-api](https://sourceforge.net/projects/youtube-transcript-api/) (MIT) fetches auto-captions without an API key. The official API only returns manual captions ([guide](https://transcriptapi.com/blog/youtube-transcript-api-complete-developer-guide)). **Use:** cheap "what the video says" text for every upload, so topics, hooks and search no longer depend on Gemini's 8-hours-a-day video allowance. We need to test whether it returns Tamil tracks for our channels.
- **Instagram:** [Instaloader](https://scrapfly.io/blog/posts/best-open-source-instagram-scrapers) (MIT, actively maintained) reads public profiles, posts and comments without logging in. It's blocked from cloud servers (our test got 404), so it needs a home or phone connection ([guide](https://www.xpoz.ai/blog/guides/open-source-social-media-scrapers-what-still-works-2026/)).
- **TikTok, for the digital footprint:** Python scrapers exist ([tiktokapipy](https://pypi.org/project/tiktokapipy/0.2.0.post2), [naseif/tiktok-scraper](https://repos.ecosyste.ms/hosts/GitHub/topics/tiktok-scraper)), but they're fragile and against TikTok's terms. Keep TikTok on ScrapeCreators or SociaVault.

### 2.2 Understanding comments
- **Code-mixed sentiment:** the [TamilMixSentiment](https://huggingface.co/datasets/community-datasets/tamilmixsentiment) dataset has 15.7k labelled YouTube comments in Tanglish. We can fine-tune a small multilingual model (MuRIL or IndicBERT) on it plus **our own ~54k Gemini-labelled comments**, so we have a local model that reads Tanglish the way Gemini does, free and with no quota. Ready-made options are weaker for Tamil: [tabularisai multilingual](https://huggingface.co/tabularisai/multilingual-sentiment-analysis) covers Hindi but not Tamil, and [Hinglish BERT](https://huggingface.co/rohanrajpal/bert-base-multilingual-codemixed-cased-sentiment) covers only Hindi-English.
- **Topics:** BERTopic with multilingual sentence embeddings works well on short and Hindi texts ([Hindi study](https://arxiv.org/pdf/2501.03843), [short-text study](https://arxiv.org/pdf/2402.03067)). We already have the embedding model (`paraphrase-multilingual-MiniLM-L12-v2`); BERTopic would give named, evolving topics instead of simple clusters.
- **Embeddings for search:** [multilingual-e5-small](https://huggingface.co/elastic/multilingual-e5-small-optimized/blob/main/README.md) is about as fast as MiniLM on a CPU and generally stronger at search ([comparison](https://aimultiple.com/multilingual-embedding-models)). With **pgvector**, Ask AI can find comments by meaning: "sound is bad" matches "audio sariyilla" with no keyword in common. Combine it with keyword search ([hybrid search guide](https://docs.railway.com/guides/hybrid-search-postgres-pgvector)).
- **Spam and bots:** no strong ready-made model exists. The best open work is rule-based ([CommentBlock](https://github.com/xenova/commentblock)) or narrow ([Kratt](https://huggingface.co/geraldadli/Kratt)). **Use:** a small classifier trained on our own AI spam labels, plus copy-paste detection: the same text from many accounts.
- **Local LLM as a free AI fallback:** llama.cpp runs Qwen3 0.6B–4B and Gemma 1B–4B on ordinary CPUs at 18–36 tokens/s for the small ones ([CPU tests](https://itsfoss.com/testing-local-llms-without-gpu), [llama.cpp](https://github.com/ggml-org/llama.cpp)), and people run it on GitHub Actions ([write-up](https://dev.classmethod.jp/articles/run-prismml-bonsai-2-on-github-actions/)). **Use:** a last-resort labeller when every cloud AI quota is used up, so labelling never stops.

### 2.3 Prediction and alerts
- **Forecasting:** our engine already uses scikit-learn HistGradientBoosting and Ridge, which are solid. What's missing is **view-curve features**: views at 1 h, 6 h, 24 h and 48 h from our snapshots, the strongest predictor once a video is live. General libraries (Prophet, [Greykite](https://github.com/rogervaas/greykite)) don't fit per-video curves better than this.
- **Change and spike detection:** [ruptures](https://pypi.org/project/ruptures/1.0.2/) (BSD) detects lasting shifts, such as a channel's views stepping up after a format change. It doesn't detect one-day spikes, so we'd keep a rolling robust z-score for those. **Use:** "something changed on date X" pins on the channel timeline, plus Telegram alerts.

## 3. Plan (in order of impact)

**E1. Freshness watchdog + self-healing.** Each engine gets a "should have run within X" rule:
- YouTube comments: 30 min
- Instagram profiles: 3 h
- Instagram comments on a post under 3 days old: 3 h
- AI backlog: 2 h
- Forecasts: 26 h
- Video analysis on a new upload: 12 h

It shows a green, amber or red engine panel on Manage, sends a Telegram alert, and automatically retries what it can. *This would have caught the Instagram stall on day one.*

**E2. Use the spare YouTube quota (free, official).**
- Re-read comments and replies on the last 90 days of videos on a rolling schedule.
- Fetch hourly stats for videos in their first 72 hours, which gives the view curve for E4.

Budget: stay under ~6,000 of 10,000 units a day.

**E3. Transcripts for every upload** (youtube-transcript-api in the worker). This feeds topics, hooks and search, uses no Gemini allowance, and gives a transcript-based analysis for videos over the video-analysis limit.

**E4. Prediction v2.**
- Add the early-views curve features, retrained nightly.
- Add an hourly "update the forecast as the hours come in" step.
- Train the Instagram model with relaxed thresholds as soon as the back catalogue allows.

**E5. Our own Tanglish model.** Fine-tune MuRIL or IndicBERT on TamilMixSentiment plus our Gemini-labelled comments, running in the GitHub worker. This gives free, unlimited, consistent mood labels; Gemini then handles only translation and hard cases.

**E6. Search by meaning.** multilingual-e5-small embeddings and pgvector in the main database, with hybrid keyword + meaning search for Ask AI and the Comments search box. It costs about 1.5 KB per comment, so it's for recent comments only; the archive keeps keyword search.

**E7. Topics v2 (BERTopic)** with named topics over time, and **spam/bot v2** with copy-paste detection plus a small classifier.

**E8. Local LLM fallback** (llama.cpp with Qwen3 or Gemma, about 1–4B) on the worker, used when every cloud AI quota is used up.

**E9. Change-point alerts** (ruptures) on channel views and comment mood, shown as pins on the timeline and sent to Telegram.

Infra notes:
- E5, E8 and BERTopic run on GitHub Actions CPU runners, which are free on public repos and limited on private ones (the budget.py minutes planner already handles this).
- Model files are cached between runs with actions/cache.
