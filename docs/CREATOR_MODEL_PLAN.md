# Pulse Creator Model: plan

Goal: our own free model that learns from every measurable KPI and tells a creator what will happen and why. It replaces
the current prediction engine, which forecasts within 2× of the real views only 46% of the time, no better than
"the channel's usual" (rank correlation 0.20).

## Three models, each doing what it's good at
| Model | Learns | Runs on | Status |
|---|---|---|---|
| **Pulse Reader** | Reading comments: mood, emotion, questions, spam, aspects | GitHub Actions CPU | First training run going |
| **Pulse Creator Model** (numbers) | Every KPI → forecasts, breakout odds, drivers | GitHub Actions CPU (gradient-boosted trees, seconds to minutes) | To build |
| **Pulse Analyst** (#5, writing) | Turning the numbers into briefs, summaries and advice in our style | Trained on Kaggle's free GPU; runs on CPU | To build, needs Kaggle key |

An LLM is the wrong tool for learning KPIs; trees on well-built features are far more accurate on numbers like these.
The LLM's job is to explain the numbers.

## What the Creator Model learns from (per video or post)
- **Packaging:**
  - title features and a meaning vector of the title;
  - thumbnail analysis (3,211 analysed);
  - duration and format (Short / long / Reel);
  - publish hour and day.
- **Early signals (nowcasting):**
  - views at 1 h, 6 h, 24 h and 48 h, from 54k snapshots;
  - like and comment velocity;
  - first-day comment mood, question share and emotion mix (from the Pulse Reader).
- **Channel context:** subscribers, recent typical views, upload rhythm, days since the last upload, topic history.
- **Niche context:** what competitors uploaded and what broke out that week; topic overlap with rising themes.
- **Cross-platform:** the same idea on Instagram (284 posts) versus YouTube.

**Targets:**
- views at 7 and 30 days versus the channel's normal, with likely ranges;
- like and comment rates;
- breakout odds (2× and above);
- subscribers gained around each upload;
- audience mood.

**Explanations:** per-video drivers ("+38% from upload time, −20% from length") using SHAP values.

**Checked like the Pulse Reader:**
- a held-out set of the newest videos;
- it replaces the current engine only if it is better on within-2× and rank correlation.

## Getting more data (all free)
1. **Track more channels in the niche:**
   - The biggest lever. 3 YouTube channels give ~2,900 videos; 30 more would give tens of thousands.
   - The YouTube quota is 7% used, and a channel's back-catalogue costs about 1 unit per 50 videos.
2. **Your own channel's private analytics** (OAuth "Connect your channel" is already built; 0 connected):
   - impressions, click-through rate, retention, traffic sources;
   - the most predictive KPIs that exist, available only for your own channel.
3. **Instagram Business Discovery** (the `graph` source is already built and needs a token): competitors' public numbers, free.
4. **Your own Instagram insights** (Instagram Login): reach, saves, shares.
5. **Denser snapshots in a video's first 48 h**, for sharper early curves.

These add stored data. The YouTube 30-day storage question (on hold) applies to it as well.

## Pulse Analyst (#5) on Kaggle
- **Training data:** about 4,000 pairs of (the numbers we sent Gemini → what Gemini wrote), from 1,256 insights and 2,695 video summaries. Commenter identities are removed.
- **Model:** a small open model (1–4B), LoRA fine-tuned with Unsloth on Kaggle's free T4, exported to GGUF and run on CPU with llama.cpp.
- **Fully automatic, from a GitHub workflow:**
  1. export the data;
  2. upload it as a **private** Kaggle dataset;
  3. start a **private** Kaggle notebook on GPU;
  4. wait for it to finish;
  5. download the model;
  6. publish it as a release.
- **Needs:** GitHub secrets `KAGGLE_USERNAME` and `KAGGLE_KEY`.

## Instagram (#6)
- A logged-out scraper was tested once from a server: Instagram returned its "not logged in" page (HTTP 404).
- Free servers (GitHub, Vercel) are refused the same way; getting past that needs paid residential proxies.
- **Free route:** Business Discovery via a Business/Creator account and a Facebook app (`IG_GRAPH_TOKEN`, `IG_GRAPH_USER_ID`), already built as the `graph` source.

## Order
1. Pulse Reader results → switch it on for the archive.
2. Creator Model v1 on existing data, compared with the current engine.
3. Pulse Analyst on Kaggle (once the secrets are added).
4. More data: more niche channels, your own channel connected, Business Discovery.
5. Creator Model v2 retrained on the bigger data.
