# Instagram: research and plan

Date: 6 November 2026. Goal: watch other Instagram creators the way we watch YouTube channels (posts, reach, engagement, and ideally every comment with AI sentiment), for free.

## What Instagram allows

| Way in | What we get about **other** creators | Comment text? | Cost | Notes |
|---|---|---|---|---|
| **Business Discovery** (official Graph API) | Followers, number of posts, each post's likes, comment count, views, link and type (Meta's docs) | **No**, only the number of comments | Free | Only works for Business/Creator accounts (not personal or age-gated). Needs **your own** Instagram professional account and a free Meta developer app, with the permissions `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement`. Calls are rate-limited per account. |
| **Instagram API for your own account** | Everything about **your** posts, including comments | Yes, for your own posts only | Free | Not useful for watching other creators. |
| **Third-party scraping services** (e.g. Apify's Instagram scrapers) | Public posts **and their comments** | Yes | Small free monthly credit, then paid | Against Instagram's terms of use; results can break when Instagram changes. Your own account is never involved, but it's a grey area. |
| Scraping ourselves | Public data | Yes | Free | Not recommended: Instagram blocks automated access quickly, and it breaks their terms. |

Sources: Meta's Business Discovery reference ([developers.facebook.com](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)) and 2026 guides ([Phyllo](https://www.getphyllo.com/post/instagram-api-guide), [Elfsight](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/), [Storrito](https://storrito.com/resources/instagram-api-2026/), [Zernio](https://zernio.com/blog/instagram-api)). The guides disagree on some limits; Meta's own documentation is used where they differ.

## Recommended plan

**Phase 1: official and free (recommended to build first).**
- Track creators by @username through Business Discovery, checking every few hours.
- **Followers over time.**
- **Each post's likes, comments and views over time.**
- **Engagement rate and outlier score per post**, the same as YouTube.
- **Best posting times, best formats** (Reel, photo or carousel) and **caption patterns** (hashtags, length, emojis).
- **AI** reads the captions and images, and writes a weekly briefing per creator.
- **Compare** Instagram and YouTube for creators who are on both.
- What you need to do once (about 20 minutes, guided):
  1. Switch your own Instagram account to a free Creator or Business account.
  2. Create a free Meta developer app.
  3. Paste one access token into Vercel.

**Phase 2: comment text (optional, your decision).**
- Comment text for other creators is only available through a third-party scraping service.
- If you want it, we'd use a service's free monthly credit to pull comments on each creator's newest posts.
- Those comments would then go through the same AI pipeline as YouTube: sentiment, Tanglish, topics and memory.
- This goes against Instagram's terms, so I'd only build it if you're comfortable with that.

## Open questions to settle before building
1. Are the creators you want to watch on Business or Creator accounts? Business Discovery can't see personal accounts.
2. Do you have, or can you make, an Instagram professional account to connect?
3. Phase 2: yes or no?
