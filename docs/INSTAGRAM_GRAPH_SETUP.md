# Instagram backup: Meta's official Business Discovery (free)

The site already supports Meta's official Instagram API as its first Instagram source (`graph` in
`web/lib/ig-sources.ts`). It only needs two settings. With them, profile numbers and the latest 12 posts of **any
public Business or Creator account** come from Meta for free. That covers followers, posts and, per post, likes,
comment count, type, link and thumbnail, and it relies less on the paid scrapers. Comment text still comes from the
other sources, because Business Discovery doesn't return it.

Time needed: about 15 minutes, once.

## What you need first
- Your own Instagram account switched to **Professional** (Business or Creator): Instagram → Settings → Account type
  and tools.
- A **Facebook Page** linked to it: Instagram → Settings → Accounts Centre → Accounts, or Facebook Page → Settings →
  Linked accounts → Instagram.

## Steps
1. **Create the app.** Go to <https://developers.facebook.com/apps> → Create app → use case *Other* → type
   *Business*. Any name works, e.g. "Creator Pulse".
2. **Add the product.** In the app, under Add products, choose **Instagram** → *API setup with Facebook login*.
3. **Get a token that doesn't expire (recommended).** Open <https://business.facebook.com/settings> → Users → **System
   users** → Add (role *Admin*). Then:
   - **Assign assets:** your Facebook Page (full control) and your app.
   - **Generate the token:** click **Generate new token**, choose your app, set expiry to **Never**, and tick these
     permissions: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management`.
   - **Copy it** and keep it private. Don't send it in chat.

   *Shortcut:* the Graph API Explorer (<https://developers.facebook.com/tools/explorer>) also gives a token, but it
   expires in about an hour (60 days if you exchange it for a long-lived one). Use the system user token so it never
   needs renewing.
4. **Find your Instagram user ID.** In the Graph API Explorer, using your token, run
   `me/accounts?fields=name,instagram_business_account`. The number under `instagram_business_account.id` is your
   Instagram user ID. It isn't secret.
5. **Add both to Vercel.** Project → Settings → Environment Variables (Production):
   - `IG_GRAPH_TOKEN` = the token from step 3
   - `IG_GRAPH_USER_ID` = the ID from step 4

   Then redeploy the site: Deployments → ⋯ → Redeploy.

## Check it works
Every Instagram fetch is logged with its provider (`ig_runs.source`). After the next Instagram refresh, rows with
source `graph` mean it is working. Ask Claude to check this for you. Personal or private accounts aren't available
through this API, so they keep using the other sources automatically. If Meta rejects the token, the run is logged
with its error and the next source is tried.

## Limits (Meta's)
- About 200 calls an hour per token. The site makes one call per profile refresh.
- Business and Creator accounts only, and only their public data: no comment text, no story or reel view counts.
- Several tokens can be listed, comma-separated, with matching user IDs in the same order.
