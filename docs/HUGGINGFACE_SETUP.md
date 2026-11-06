# Always-on engine on a free Hugging Face Space

A free Space (2 CPUs, 16 GB memory) runs the background job's steps **non-stop**: YouTube sync, the
sentiment model, local AI (emotions, topics) and the online AI, in an endless loop. While it is working,
the GitHub job and the website's backup scheduler stand aside; if it ever stops, they take over again
within 30 minutes. The code comes from GitHub, so updates arrive automatically.

## 1. Create the Space (2 min)

1. Open **https://huggingface.co/new-space**.
2. **Space name:** `pulse-engine`. **License:** leave empty.
3. **Select the Space SDK:** **Docker** → template **Blank**.
4. **Space hardware:** **CPU basic · 2 vCPU · 16 GB · FREE**.
5. **Visibility: Public.** (The code is already public on GitHub; your keys stay hidden in secrets; the
   page only shows which step ran last. Public lets the website keep it awake without a token.)
6. Click **Create Space**.

## 2. Add the two files (3 min)

In the new Space, open the **Files** tab:

1. Click **README.md** → **Edit** (pencil) → replace **everything** with the content of
   [deploy/huggingface/README.md](https://github.com/GuhanathanG/Youtube-Analytics/blob/main/deploy/huggingface/README.md)
   (open it → **Raw** → select all → copy) → **Commit changes to main**.
2. **+ Add file → Create a new file** → name it `Dockerfile` → paste the content of
   [deploy/huggingface/Dockerfile](https://github.com/GuhanathanG/Youtube-Analytics/blob/main/deploy/huggingface/Dockerfile)
   (Raw → copy) → **Commit new file to main**.

## 3. Add your keys (5 min)

Space → **Settings** → **Variables and secrets** → **New secret**, one per row. Use the same values as in
GitHub/Vercel (GitHub and Vercel don't show saved values, so copy them from where you got them):

| Secret | Where to find it |
|---|---|
| `DATABASE_URL` | the Mumbai link (same as `NEW_DATABASE_URL`) |
| `YOUTUBE_API_KEY` | console.cloud.google.com → APIs & Services → Credentials |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key |
| `GROQ_API_KEY` | console.groq.com → API Keys |
| `MISTRAL_API_KEY` | console.mistral.ai → API Keys |
| `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com → AI → Workers AI → use REST API |
| `OPENROUTER_API_KEY` (if you have one) | openrouter.ai → Keys |
| `ARCHIVE_DATABASE_URL` | the Neon link (console.neon.tech → Connect) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | the same as in Vercel (from @BotFather) |

And one **New variable** (not secret): `SENTIMENT_MODEL` = `cardiffnlp/twitter-xlm-roberta-base-sentiment`.

Adding secrets restarts the Space. The first build takes about **10 minutes** (it installs the AI
libraries). The **Logs** tab then shows lines like `▶ sync`, `▶ analyze`, `▶ ai`.

## 4. Keep it awake (2 min)

Free Spaces sleep after 48 hours without visits. The website visits it every few minutes once it knows
the address:

1. The Space's direct address is `https://YOUR-USERNAME-pulse-engine.hf.space` (shown under
   **⋯ → Embed this Space → Direct URL**). Opening it shows `{"engine": "Creator Pulse", ...}`.
2. Vercel → **youtube-analytics-web → Settings → Environment Variables → Add**:
   `ALWAYS_ON_URL` = that address (Production) → **Save** → **Deployments → ⋯ → Redeploy**.

## 5. Check (1 min)

Website → **Manage** → Engine panel: **Always-on server: working · just now**. GitHub's half-hourly
runs now finish in seconds ("nothing to do here").

### If something goes wrong
- **Build error:** Space → Logs → *Build*: usually a typo in the Dockerfile copy; paste it again.
- **`Runtime error` / restarts:** Logs → *Container*: a missing or wrong secret (e.g. `DATABASE_URL`).
- **Paused/sleeping:** open the Space page once, and check `ALWAYS_ON_URL` in Vercel.
- To stop it: Space → Settings → **Pause Space**. GitHub takes over again within 30 minutes.
