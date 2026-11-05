# Requesting more YouTube Data API quota (free)

Google gives each project **10,000 units a day**. A quota increase is **free**, but Google first checks that the
project follows the **YouTube API Services Terms and Developer Policies** (a "compliance audit"). It usually takes 1–4 weeks.

## Before you apply: one policy to know

Google's Developer Policies say that data you get from the API without a user's permission (like public comments)
should be **refreshed or deleted within 30 days**. This app stores comments for long-term analysis. A reviewer may ask
about that. The honest answer is in the form text below: it's a personal, internal research tool, nothing is
published, and we can refresh or delete data on request. Google may still turn the request down or ask for changes.
That doesn't affect your current 10,000 units.

## Where to apply

1. Open **<https://support.google.com/youtube/contact/yt_api_form>**.
2. Choose **"I would like to request additional quota"** (it may be called "Audit and quota extension").
3. Sign in with the **same Google account** that owns the `creator-analytics` Cloud project.
4. You'll need your **project number**. In <https://console.cloud.google.com/>, pick the project and open **Dashboard**:
   "Project number" is shown at the top.

## Text to paste (adjust the names and numbers in [brackets])

**Organization / developer name:** [Your full name] (individual developer)

**Contact email:** [your email]

**Project number:** [your project number]

**API client / app name:** Creator Analytics (private, internal)

**Website:** [your Vercel address, e.g. https://youtube-analytics-web-jet.vercel.app] (password-protected; I can give a reviewer access)

**How many units do you need per day?** 100,000

**Describe your use case:**

> Creator Analytics is a private, password-protected research dashboard I use personally to study audience
> sentiment on a small number of public YouTube channels I follow (currently [1–3] channels). It uses the YouTube
> Data API v3 read-only, with an API key (no OAuth, no user accounts), and calls only `channels.list`,
> `playlistItems.list`, `videos.list`, `commentThreads.list` and `comments.list`.
>
> The app reads public comments and video statistics. It analyses them with language and sentiment models,
> because many comments are in Tamil, Hindi and other Indian languages, often written in English letters. It then
> shows aggregate charts: sentiment over time, common topics, and questions viewers ask. Nothing is published,
> resold or shared with third parties. The only user is me.
>
> The current 10,000 units a day lets me read about 1 million comments a day in the best case. The channels I study
> have more than 1,000 videos each and several million comments in total. That makes it hard to keep the history
> complete and the statistics fresh. 100,000 units a day would let me finish the initial download in reasonable time
> and refresh video statistics daily, as the policies expect.

**How do you comply with the data storage and refresh policies?**

> Video statistics are refreshed at least daily. Comments are kept only for my private analysis. I'm happy to refresh
> stored comments within 30 days or delete them on request, and to add an automatic 30-day refresh/delete job if
> required. All data is stored in a private database; the dashboard is password-protected and not indexed by search engines.

**Do you display YouTube data to users?** Only to myself, inside the password-protected dashboard. Each video and
channel links back to YouTube, and videos play through the official YouTube embedded player.

**Screenshots:** attach 2–3 screenshots of the dashboard (Overview, a Channel page, the Comments page).

## After you apply

- Google replies by email. They may ask follow-up questions; answer them honestly using the points above.
- If it's approved, change `DAILY_QUOTA` to the new limit minus about 5% (for example `95000`):
  - in **GitHub → Settings → Secrets and variables → Actions → Variables** (or the workflow file);
  - and in **Vercel → Settings → Environment Variables**.

  Then tell Claude, and the engine's per-run limits can be raised to match.
