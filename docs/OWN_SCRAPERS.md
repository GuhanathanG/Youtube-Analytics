# Building our own free scrapers: research and plan

Status: research done, nothing built yet. The aim is to stop paying per request (Apify, ScrapeCreators, SociaVault, HikerAPI, Bright Data) for the data we need most often. We want to keep those services only as a fallback.

## 1. What we actually need (volume)

| Data | Accounts | How often | Requests a day |
|---|---|---|---|
| Instagram profile + latest 12 posts (counts) | ~10 | every 2 h | ~120 |
| Instagram comments on new posts | ~10 | a few new posts a day | ~30–100 |
| Instagram back catalogue (one-off) | per new account | once | ~10–20 pages |
| YouTube everything | all | already free (official API, 10k units/day) | n/a |
| Keyword demand | n/a | already free (autocomplete endpoint) | n/a |

Our volume is tiny. Scrapers get blocked because of thousands of requests per IP. At ~120 profile reads a day we are far below the roughly 200 per hour per IP that logged-out tools report.

## 2. Options

### A. Logged-out Instagram web endpoints, from a home IP (recommended)
- **Profiles:** `web_profile_info?username=…` returns the profile JSON with the latest 12 posts and their like, comment and view counts, without logging in. That covers what most of our 2-hourly checks need.
- **Weak spot:** IP reputation. Instagram blocks datacenter IPs quickly, and that includes GitHub Actions, Vercel and Oracle Cloud. A home internet connection (a residential IP) is what works.
- **Free way to get a residential IP:** run a GitHub Actions **self-hosted runner** on a computer at home, such as an old laptop, a Raspberry Pi or the desktop. The Instagram job in our existing workflow then runs there instead of on GitHub's servers. It needs no new hosting, no new secrets, and no code outside the repo.
- **Breakage:** this endpoint changes less often than Instagram's GraphQL `doc_id` queries, which reportedly break every 2–4 weeks. We would watch for breakage with the same "exhausted / failed → rest the source" logic `lib/ig-sources.ts` already has. The paid providers take over automatically when it fails.

### B. Logged-in scraping with an Instagram account (not recommended)
This would give full comment threads and older posts. However:
- It breaks Instagram's terms for account holders.
- The account gets banned or checkpointed.
- The Meta v. Bright Data ruling (2024) only covered **logged-out** scraping of public data.

We should not do this.

### C. Headless browser (Playwright) against public pages
Heavier and slower than option A, and it hits the same IP problem. It is only useful as a second way to read the same public data when the JSON endpoint changes. Keep it as a backup idea.

### D. Open-source libraries
- **Instaloader** (Python): mature, and works logged out for profiles and posts. We could call it from the worker.
- **yt-dlp:** covers YouTube and partly Instagram reels.

Both could replace hand-written requests, but we would still need the home IP from option A.

### E. YouTube beyond the API quota
The official API stays the main source; it is free and allowed. If the 10k units a day ever run out, `youtubei` (the internal API the website uses, as in yt-dlp) can read comments without quota. That is a grey area under YouTube's terms, so use it only as a fallback.

## 3. Legal and terms of service (not legal advice)
- **Meta v. Bright Data** (N.D. Cal., Jan 2024): logged-out scraping of public Facebook and Instagram data did not breach Meta's terms, because the scraper was a "visitor", not a "user". It is a district court ruling and narrow. It says nothing about logged-in scraping, and Meta can change its terms.
- **Our rules:**
  - logged out only;
  - public accounts only;
  - low request rates;
  - no personal data beyond what the dashboard shows (public counts and comments);
  - honour removals.

## 4. Plan (when you say go)
1. **Probe (needs your OK).** One logged-out request to `web_profile_info` for one public account, from GitHub's servers and from a home machine, to see which works. My earlier attempt from this cloud session was blocked by the session's safety check, so this needs your explicit go-ahead.
2. **Provider.** Add a `self` source to `lib/ig-sources.ts`, ordered first:
   - profile and latest 12 posts from `web_profile_info`;
   - realistic browser headers;
   - 1 request every few seconds with jitter;
   - existing resting and fallback to the paid providers on failure.
3. **Home runner.** A short guide to install a GitHub self-hosted runner on a home PC or Raspberry Pi (about 10 minutes). The Instagram workflow job gets `runs-on: [self-hosted]`, with the cloud runner as the fallback when the home machine is off.
4. **Comments.** Logged-out comment reads give only a preview of each post's comments. Keep a paid provider, free tier first, for full comment threads, but only for new posts. That keeps costs near zero.
5. **Watchdog.** If `self` fails 3 runs in a row, send a Telegram alert. The existing alert channel is reused.

Expected result: about 90% of Instagram requests become free, and the paid keys are used only for full comment threads and outages.

## Sources
- [Meta v. Bright Data: Farella Braun + Martel summary](https://www.fbm.com/technology/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/)
- [TechCrunch: court rules in favor of Bright Data](https://techcrunch.com/2024/01/24/court-rules-in-favor-of-a-web-scraper-bright-data-which-meta-had-used-and-then-sued)
- [MediaPost: Meta abandons lawsuit](https://www.mediapost.com/publications/article/393996/meta-abandons-lawsuit-against-bright-data-over-scr.html)
- [Scrapfly: best open-source Instagram scrapers](https://scrapfly.io/blog/posts/best-open-source-instagram-scrapers)
- [SocialCrawl: Instagram scraping in 2026](https://www.socialcrawl.dev/blog/instagram-scraping-2026)
- [DEV: scraping Instagram without getting banned (2026)](https://dev.to/olams/scraping-instagram-without-getting-banned-what-actually-works-in-2026-3jfh)
