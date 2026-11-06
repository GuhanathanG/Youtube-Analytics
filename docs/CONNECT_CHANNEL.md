# Connect your channel (private YouTube Analytics)

Connecting a channel you own unlocks numbers that only the owner can see: watch time, how much of each
video people watch (% watched), subscribers gained/lost, where views come from, and — where Google
allows — impressions and click-through rate. They appear on the channel and video pages and turn into
next moves (e.g. *fix the opening of a video that loses viewers*). Access is **read-only**.

One-time setup (~10 minutes) in the same Google Cloud project as your YouTube API key:

## 1. Turn on the YouTube Analytics API
console.cloud.google.com → pick your project → **APIs & Services → Library** → search
**YouTube Analytics API** → **Enable**.

## 2. Sign-in screen (OAuth consent)
**Google Auth Platform** (or *APIs & Services → OAuth consent screen*):
1. **Branding:** App name `Creator Pulse`, your email as support and developer contact. Save.
2. **Audience:** User type **External**. Under **Test users**, add the Google account(s) that own your channel(s).
3. **Data access → Add or remove scopes:** add
   `https://www.googleapis.com/auth/yt-analytics.readonly` and `https://www.googleapis.com/auth/youtube.readonly`. Save.
4. **Publishing status:** while it says *Testing*, Google ends the connection every 7 days (you'd press
   Connect again weekly). For personal use you can press **Publish app**: it stays unverified, so the
   sign-in shows "Google hasn't verified this app" → **Advanced → Go to Creator Pulse** — and then the
   connection lasts.

## 3. Create the sign-in client
**Clients → Create client** → Application type **Web application** → Name `Creator Pulse` →
**Authorized redirect URIs → Add URI:**

```
https://youtube-analytics-web-jet.vercel.app/api/oauth/google/callback
```

→ **Create**. Copy the **Client ID** and **Client secret**.

## 4. Give them to the website
Vercel → **youtube-analytics-web → Settings → Environment Variables**, add (Production):
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` → **Save** → **Deployments → ⋯ → Redeploy**.

## 5. Connect
Website → **Manage → Connect your channel → Connect a YouTube channel** → pick the Google account (and
the brand channel, if you have several) → **Allow**. You land back on Manage with *Connected: …*; the
first numbers load straight away and refresh every 6 hours.

### Notes
- The long-term Google key is stored **encrypted** (AES-256-GCM). The encryption key comes from
  `APP_PASSWORD` + `CRON_SECRET` (or `TOKEN_KEY` if you set one). If you change those, press Connect again.
- **Disconnect** on Manage deletes the key and the private numbers. You can also remove access at
  myaccount.google.com → Security → Third-party connections.
- Impressions/click-through come from the API only for some channels; if Google doesn't provide them,
  the rest still works.
