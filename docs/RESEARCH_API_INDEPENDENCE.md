# Research: fewer API dependencies, our own scrapers, our own AI model

22 Nov 2026. Based on:
- Creator Pulse's live usage (database queries on 22 Nov);
- the YouTube API Developer Policies (read directly);
- Meta's developer docs;
- India's DPDP Act commentary;
- 2025–26 research and tooling reports.

Sources are at the end. This is research, not legal advice; the policy points are worth checking with a lawyer before building on them.

---

## 1. Where we depend on outside services today

| Service | What it does for us | Live usage | Cost now |
|---|---|---|---|
| **YouTube Data API** (official) | Channel and video stats, uploads, comments and replies for the 3 YouTube channels | ~730 of 10,000 free daily units (7%) | Free |
| YouTube RSS + WebSub (official, public) | Instant new-upload alerts | — | Free |
| YouTube Analytics API (official, OAuth) | Private stats for a creator who connects their own channel | When connected | Free |
| **ScrapeCreators** | Instagram profile/post details, comments, history for the 4 Instagram accounts | 30 days: 431 detail runs (4,345 items), 54 comment runs (1,617 comments) | Credits ($47 per 25k); 781 left |
| SociaVault, HikerAPI, Bright Data, **Apify** | Instagram fallbacks when ScrapeCreators fails | A handful of runs a month | Apify ≈ $0.29 in 30 days |
| Gemini, Mistral, Groq, GitHub Models, Cloudflare (LLMs) | Deep comment reading, summaries, Ask AI, briefs, archive reading | Hundreds to ~900 requests a day, mostly the archive | Free tiers |
| Hugging Face models (run by us) | Mood (sentiment), emotion, embeddings, Tanglish rules | On GitHub Actions | Free |

**Takeaway:** the expensive or fragile dependencies are **Instagram data** and **LLM free tiers**. The YouTube API is free, stable and only 7% used, so it is not a bottleneck.

---

## 2. The most important finding: YouTube's own rules

Every YouTube API user agrees to the **YouTube API Services Developer Policies**. I read them directly. Several points apply to Creator Pulse **as it is today**, before any new building:

| Rule | Section | What it means for us |
|---|---|---|
| **No scraping**, and no "obtaining scraped YouTube data" | III.E.6 | A YouTube scraper (InnerTube, yt-dlp, comment downloaders) would break the terms we already accepted for the API key. |
| **No undocumented APIs** | III.D.7 | Same: the internal `youtubei` endpoints are off-limits while we use the API. |
| **Public data** (fetched with an API key, e.g. competitors' comments and stats) may be stored **at most 30 days**, then deleted or refreshed | III.E.4.d, III.E.4.b | Our archive keeps 1.28M comments for years, and the prediction engine and outlier finder keep stats long-term. That needs a refresh/delete cycle. |
| **Authorized data** (a creator who connected their channel) | III.E.4.b–c | Analytics and statistics may be kept as long as needed if authorization is re-checked every 30 days. Other authorized data (e.g. comments) must be refreshed or deleted every 30 days. |
| **Derived metrics**: no new metrics *from* API data, unless clearly labelled as independently calculated | III.E.4.h | Outlier multiples, mood scores and forecasts are fine **with a clear "calculated by Creator Pulse, not YouTube" label**. |
| **Aggregation** only across channels of the *same* content owner, visible only to that owner | III.E.2 | Cross-channel views (Compare, Outliers, Radar) mix different owners' API data. This is the grey area most worth a careful read or an API compliance audit. |

The policy text I read says **nothing explicit about training AI models**. However, a model trained on data we weren't allowed to keep inherits the problem.

### What this means
1. **Don't build a YouTube scraper.** It's against the terms, it's fragile (comment formats changed again in 2026 and broke the popular open-source downloader), and it would solve a problem we don't have (quota is 7% used).
2. **Make the archive compliant instead.** Re-fetching every stored comment once every 30 days costs roughly:
   - 1.28M comments ÷ 100 per call ≈ 13k calls a month;
   - ≈ **430 extra units a day** (plus replies).
   - That fits easily in the free 10,000.
   - Comments deleted on YouTube then disappear from ours too, which is what the rules want.
3. **Add disclosure labels** to our own metrics.
4. **Consider the official audit** if we want long-term analytics storage. Section L (from 1 June 2026) offers audited analytics developers extra data-storage permissions.

---

## 3. Instagram: what our own scraper would mean

### What's possible
| Route | Data | Reliability | Rules | Cost |
|---|---|---|---|---|
| **Instagram API with Instagram Login** (official, creator connects their own account) | Own posts, comments, insights, webhooks for new comments | High | Allowed | Free |
| **Business Discovery** (official, via your own professional account) | Other *professional* accounts' profile and per-post likes, comments **count**, views | High | Allowed | Free |
| **Logged-out scraper** (our own code + proxies) | Public profile, some posts; comments mostly *not* available logged out | **Low**: 2026 reports describe HTTP 400/429 after a few requests, internal `doc_id` rotating every 2–4 weeks, Instaloader's anonymous fetch failing with 401 | US ruling (*Meta v. Bright Data*, 2024): Meta's terms don't bar logged-out scraping of public data. Not tested in India. | Residential proxies ≈ $1–8 per GB + ongoing fixes |
| **Logged-in scraper** (accounts) | Everything incl. comments | Medium, then accounts get banned | Breaks Meta's terms (the court case excluded logged-in scraping) | Accounts + proxies + bans |
| **Aggregators** (ScrapeCreators etc., today) | Everything we use | Medium-high, with our multi-provider fallback | They carry the scraping risk | Our volume ≈ 4.6k credits a month ≈ **$9–10/month** |

### Recommendation
- **Use the official routes first:**
  - **Connect your own Instagram account** (Instagram Login) for your own posts, comments and insights.
  - Use **Business Discovery** for competitors' public numbers.
  - This could cut aggregator use for numbers to near zero.
- **Keep aggregators only for competitor comments.** The official API can't give other accounts' comment text, and a logged-out scraper can't either.
- **Build our own logged-out scraper only as an extra fallback** for public profile/post numbers. At ~$10/month of aggregator spend, a self-maintained scraper (proxies + fixing it every few weeks) costs more in time than it saves. It is a resilience project, not a savings one.

**India (DPDP Act 2023, Rules notified Nov 2025, most duties from May 2027):**
- Section 3(c)(ii) excludes personal data **the person made public themselves**. That plausibly covers public comments.
- Lawyers call the scope unclear for aggregation, profiling and AI.
- Safe practice: keep commenter names and ids out of training data and exports, and delete on request.

---

## 4. Training our own AI model

### What we have
- **Archive:** 1.28M comments, all with a mood label (mostly from LLMs), and 334k with richer AI labels (emotion, question, suggestion, spam, aspects, translation).
- **Main database:** ~55k recent comments; about **half are Tanglish** (Tamil in English letters).
- That is roughly **30–60 million tokens** of text (estimate).

This is **an excellent fine-tuning dataset** and **far too small to train an LLM from scratch**.

**Caveat:** YouTube data must first be in a compliant state (section 2) before it is used for training.

### Three levels

**Level 1: Our own comment classifier (recommended, highest value)**
- **What:** fine-tune one multilingual model (XLM-R base or MuRIL, which handle Tamil and Tanglish) on our LLM labels. It predicts **mood, emotion, question/suggestion, spam and aspects in one pass**.
- **Train:** Kaggle's free GPUs (2× T4, ~30 h/week, 12 h sessions); a few hours per run.
- **Run:** on GitHub Actions CPU as a compressed (int8 ONNX) model, at no cost and with no rate limits.
- **Replaces** most of today's LLM calls for comment reading, including the archive work that hits Gemini's daily cap.
- **Quality check:**
  - Hold out 10% of the data, and hand-check ~500 Tanglish comments, because LLM labels are noisy.
  - Published Tanglish benchmarks are low (e.g. macro-F1 0.26 in a 2024 shared task). Our edge is labels from our own audience.
- **Effort:** ~1–2 weeks.

**Level 2: Our own small text generator for summaries, briefs and reply drafts**
- **What:** fine-tune a small open model (Qwen or Gemma family, 1–4B parameters) with LoRA using Unsloth on a free T4. Export it to GGUF and run it on CPU with llama.cpp.
- **Where it runs:**
  - batch jobs on GitHub Actions (slow but free);
  - or the free **Oracle ARM server** (task 10, still pending), which is fast enough for a 4B model.
- **Trade-off:**
  - Writing quality is below Gemini's, and live chat (Ask AI) is slow on CPU.
  - Good for nightly summaries, topic names and briefs. Keep a free cloud LLM as the fallback for chat.
- **Effort:** ~2–3 weeks after Level 1.

**Level 3: Training an LLM from scratch (not recommended)**
- A 2026 Tamil-first model (Agaram 2.5B) needed ~1.35B tokens, and most of its Tanglish text was machine-generated.
- We have ~30–60M tokens, about 20–40× too little, and no budget for the GPU time.
- Open Indic models already exist (Sarvam 30B/105B under Apache 2.0, Tamil-LLaMA), but they are too big to host for free.

---

## 5. Suggested order

| Phase | Work | Why first |
|---|---|---|
| **P0 – Rules** | 30-day refresh/delete cycle for YouTube API data; "independently calculated" labels; review cross-channel pages; remove commenter identity from exports and training sets | Protects the API key the whole product depends on |
| **P1 – Official routes** | Instagram Login for your own account (comments + webhooks) + Business Discovery for competitor numbers; YouTube OAuth for your own channel | Fewer paid calls, more reliable data |
| **P2 – Own classifier** | Level 1 model, trained on Kaggle, run on GitHub Actions | Biggest cut in LLM dependence |
| **P3 – Oracle server** | Set up the free ARM server (task 10) | Needed to host Level 2 |
| **P4 – Own small generator** | Level 2 model for summaries and briefs | Last big LLM dependency |
| **P5 – Resilience** | Logged-out Instagram scraper as one more fallback, behind the existing chain | Only if aggregators become unreliable or expensive |

## 6. Decisions for you
1. **YouTube compliance:** refresh-every-30-days (keeps the archive, ~430 units a day), or keep only 30 days of public data (simpler, loses history)?
2. **Connect your own accounts?** YouTube (OAuth already built) and Instagram (new). Needs a Facebook app with Instagram permissions.
3. **Go ahead with Level 1** (own classifier) now?
4. **Oracle server:** create the account so Level 2 has somewhere to run.

---

## Sources
- YouTube API Services – [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) (III.D.7, III.E.2, III.E.4, III.E.6), [Quota and Compliance Audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits), [revision history](https://developers.google.com/youtube/terms/revision-history)
- [youtube-comment-downloader issue #174](https://github.com/egbertbouman/youtube-comment-downloader/issues/174); [Scrapfly: open-source YouTube scrapers 2026](https://scrapfly.io/blog/posts/best-open-source-youtube-scrapers)
- Meta – [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery), [Instagram Platform changelog](https://developers.facebook.com/docs/instagram-platform/changelog), [Platform Terms](https://developers.facebook.com/terms), [user data deletion](https://developers.facebook.com/blog/post/2024/11/15/user-data-deletion-requests/)
- [Quinn Emanuel on *Meta v. Bright Data*](https://www.quinnemanuel.com/the-firm/news-events/client-alert-what-does-the-meta-v-bright-data-summary-judgment-ruling-mean-for-web-scraping/); [Courthouse News](https://www.courthousenews.com/federal-judge-rules-against-meta-in-data-scraping-case/)
- [Scrapfly: scraping Instagram in 2026](https://scrapfly.io/blog/posts/how-to-scrape-instagram); [SocialCrawl: which Instagram scrapers still work](https://www.socialcrawl.dev/blog/instagram-scraping-2026); [Instaloader troubleshooting](https://instaloader.github.io/troubleshooting.html)
- [ScrapeCreators comments API pricing](https://scrapecreators.com/blog/instagram-comments-api); [DataImpulse proxy pricing 2026](https://dataimpulse.com/blog/residential-proxy-pricing-comparison/); [AIMultiple proxy pricing](https://aimultiple.com/proxy-pricing)
- DPDP: [PIB – Rules notified](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190655&reg=48&lang=2), [India Briefing – publicly available data](https://www.india-briefing.com/news/india-dpdp-act-publicly-available-personal-data-46899.html/), [Law School Policy Review on AI and public data](https://lawschoolpolicyreview.com/2026/01/13/publicly-available-data-under-the-dpdp-act-the-limits-of-exemptions-in-ai-driven-processing/), [FPF explainer](https://fpf.org/blog/the-digital-personal-data-protection-act-of-india-explained/)
- Tanglish models: [DravidianLangTech 2024](https://aclanthology.org/2024.dravidianlangtech-1.39.pdf), [arXiv 2503.23295](https://arxiv.org/abs/2503.23295), [MuRIL for Tanglish offensive language](https://arxiv.org/pdf/2110.02852)
- Compute and tooling: [Free cloud GPUs 2026](https://gpuperhour.com/blog/free-cloud-gpus-and-credits), [Colab FAQ](https://research.google.com/colaboratory/faq.html), [Unsloth Qwen3 guide](https://unsloth.ai/docs/models/tutorials/qwen3-how-to-run-and-fine-tune.md), [Gemma on a free GPU, run on CPU](https://huggingface.co/blog/pankajpandey-dev/train-gemma-with-hindi), [XLM-R int8 ONNX example](https://huggingface.co/GLLhJpFfYB/XLM-R-Large-ClaimDetection-ONNX-INT8)
- Indic LLMs: [Agaram 2.5B](https://arxiv.org/html/2610.18420v2), [Tamil-LLaMA](https://arxiv.org/pdf/2311.05845), [Sarvam AI](https://en.wikipedia.org/wiki/Sarvam_AI)
