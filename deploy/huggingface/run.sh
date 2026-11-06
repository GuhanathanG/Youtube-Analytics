#!/usr/bin/env bash
# Endless loop of the background job's steps. Each step has a time limit; a failing step never stops
# the loop. A heartbeat after every step tells the website and GitHub that this engine is working.
set -u
cd "$(dirname "$0")/../.."
STATUS=/tmp/pulse-status.json
python deploy/huggingface/status.py "$STATUS" &   # small status page on port 7860 (Spaces need one)

step() { # name, then the command
  local name="$1"; shift
  local t0=$(date +%s)
  echo "▶ $name"; "$@"; local rc=$?
  echo "{\"step\": \"$name\", \"exit\": $rc, \"seconds\": $(( $(date +%s) - t0 )), \"at\": \"$(date -u +%FT%TZ)\"}" > "$STATUS"
  python -m ytanalytics heartbeat --name space --info "$name exit $rc" || true
  return 0
}

python -m ytanalytics init-db || true
last_pull=$(date +%s); last_archive=0
while true; do
  python -m ytanalytics heartbeat --name space --info "cycle start" --new-cycle || true
  # Code updates from GitHub, at most hourly (a restart of the Space also updates).
  if [ $(( $(date +%s) - last_pull )) -gt 3600 ]; then
    if git pull --ff-only -q; then pip install --user -q -r requirements.txt -r requirements-ai.txt || true; fi
    last_pull=$(date +%s)
  fi
  step "sync"     python -m ytanalytics sync --minutes "${SYNC_MINUTES:-6}"
  pending=$(python -m ytanalytics pending 2>/dev/null || echo 0)
  topics=$(python -m ytanalytics topics-due 2>/dev/null || echo 0)
  [ "$pending" != "0" ] && step "analyze" python -m ytanalytics analyze --minutes "${ANALYZE_MINUTES:-8}"
  { [ "$pending" != "0" ] || [ "$topics" = "1" ]; } && step "local-ai" python -m ytanalytics local-ai --minutes "${LOCAL_AI_MINUTES:-4}"
  step "ai"       python -m ytanalytics ai --minutes "${AI_MINUTES:-8}"
  if [ -n "${ARCHIVE_DATABASE_URL:-}" ] && [ $(( $(date +%s) - last_archive )) -gt 3600 ]; then
    step "archive" python -m ytanalytics archive --minutes 5; last_archive=$(date +%s)
  fi
  sleep "${PAUSE_SECONDS:-30}"
done
