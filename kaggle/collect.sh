#!/usr/bin/env bash
# Collect a finished Pulse Analyst run from Kaggle: download its results and, if they aren't published yet,
# publish the model as a GitHub release and record it. Prints one word: published / already-published / no-output.
# Usage: kaggle/collect.sh <kaggle-user> <release-tag>
set -euo pipefail
U="$1"; TAG="$2"
rm -rf analyst-out && mkdir -p analyst-out
kaggle kernels output "$U/pulse-analyst" -p analyst-out -q --file-pattern 'metrics\.json|samples\.json|\.log$' >&2 || true
# Where the time went (for tuning): the notebook prints stage timings.
grep -hoE 'train [0-9]+ test [0-9]+ gpu[^"]*|stage [a-z]+ [0-9.]+ min|trained in [^"]*|done [0-9.]+ min' analyst-out/*.log 2>/dev/null | head -20 >&2 || true
if [ ! -f analyst-out/metrics.json ]; then echo no-output; exit 0; fi
if python -m ytanalytics analyst-known --out analyst-out; then echo already-published; exit 0; fi
kaggle kernels output "$U/pulse-analyst" -p analyst-out -q --file-pattern 'pulse-analyst\.gguf' >&2
[ -f analyst-out/pulse-analyst.gguf ] || { echo no-output; exit 0; }
gh release create "$TAG" analyst-out/pulse-analyst.gguf analyst-out/metrics.json analyst-out/samples.json \
  --title "Pulse Analyst ($TAG)" --latest=false --notes "Our own writing model (GGUF, CPU). Test results in metrics.json." >&2
python -m ytanalytics analyst-save --out analyst-out --url "https://github.com/${GITHUB_REPOSITORY}/releases/download/$TAG/pulse-analyst.gguf" >&2
python -m ytanalytics progress analyst x --done --note "$(python -c "import json; m=json.load(open('analyst-out/metrics.json')); print(f\"valid JSON {m['valid_json']:.0%}, summary overlap with the cloud AI {m['summary_word_overlap']:.0%} on {m['test_pairs']} held-out videos\")")" >&2
echo published
