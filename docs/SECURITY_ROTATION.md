# Changing the database password and CRON_SECRET

Both values have appeared in places they shouldn't (earlier set-up chats), so change them once. Each takes about
5 minutes. Do each one in a single sitting: between changing a value and updating it everywhere, the site or the
background jobs can't connect, and they recover by themselves once everything matches.

Never paste the new values into a chat (including with Claude), an issue or a commit.

## 1. Main database password (Supabase, Mumbai)

1. **Reset the password.** Go to supabase.com → your project → **Project Settings → Database → Reset database
   password**. Let it generate a strong one, then copy it.
2. **Build the new connection link.** Copy **Connect → Connection string**, the same kind you use today (Transaction
   pooler, port 6543), and put the new password in it. If the password has symbols such as `@ : / ? #`, use the
   generated one or URL-encode them.
3. **Update it everywhere it's used:**
   - **Vercel:** Project → Settings → Environment Variables → `DATABASE_URL` → Edit → paste → Save (Production and
     Preview).
   - **GitHub:** repository → Settings → Secrets and variables → Actions → `DATABASE_URL` → Update.
   - **Hugging Face Space** (only if you set up the always-on worker): Space → Settings → Secrets → `DATABASE_URL`.
4. **Redeploy the site:** Vercel → Deployments → ⋯ on the latest → **Redeploy**.
5. **Check it:** GitHub → Actions → *Sync & analyze* → **Run workflow**. A green run means the background jobs are
   connected. Then open the site and sign in.

The archive and training databases (Neon) are separate and keep their own passwords. Their links are stored in the
`app_secrets` table and the `ARCHIVE_DATABASE_URL` secret, and they don't need changing for this.

## 2. CRON_SECRET (the key the 2-minute engine timer uses)

1. **Make a new random key** of at least 16 characters, for example 40 random letters and digits from a password
   manager. In a terminal, `openssl rand -hex 24` also works.
2. **Vercel:** Settings → Environment Variables → `CRON_SECRET` → Edit → paste the new key → Save, then **Redeploy**.
3. **cron-job.org:** open the job that calls `https://youtube-analytics-web-jet.vercel.app/api/cron` → Edit. Wherever
   the old key appears, replace it with the new one: in the URL (`?key=…`) or in the **Headers** tab
   (`Authorization: Bearer …`). Save.
4. **Check it:** in cron-job.org, the job's next runs should show **200 OK** (a **401** means the key doesn't match
   yet). If the engine stays stopped for 15 minutes, the engine alarm tells you (alerts page, and Telegram if set up).

## After both
Tell Claude "rotated". It can then confirm, without seeing the values, that the background jobs and the engine are
running again.
