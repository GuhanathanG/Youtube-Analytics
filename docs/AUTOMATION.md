# What runs by itself

Nothing below needs a button press. All of it runs on free plans (public GitHub repo, Kaggle free GPU, free databases).

| Job | Workflow | Schedule | What it does |
|---|---|---|---|
| Sync & analyse | sync.yml | every 30 min | new videos/comments, mood, AI reading, archive; then the watchdog |
| Training channels | training.yml | every 6 h | adds queued Lab channels, refreshes the training database |
| Archive reading | archive-read.yml | every 6 h | reads archived comments |
| Creator Model | model.yml | nightly | retrains the prediction engine; keeps the better feature set |
| Pulse Reader | reader.yml | nightly check | retrains when 2,000+ new comments were read by the cloud AI; switches only if it is not worse |
| Pulse Analyst | analyst.yml | nightly check | trains on Kaggle when there is no model yet or 10%+ more examples; needs a phone-verified Kaggle account |

## Watchdog (ytanalytics/watchdog.py, last step of every sync)

- Starts a job whose last run is older than its schedule plus slack (GitHub sometimes skips scheduled runs).
- Retries a failed run once, 30 minutes later.
- After two failures in a row: one alert (alerts page + Telegram if set up), then waits for the job's next regular slot.
- Switches a schedule back on if GitHub disabled it, and re-confirms every schedule as active once a day
  (GitHub turns schedules off after 60 days without repository activity).
- Uses the sync job's own token (`actions: write`); no extra secrets.

Runs started by the watchdog go through the same "is it worth it" checks as scheduled runs.
