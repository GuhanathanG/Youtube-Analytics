# Creator Pulse always-on engine (Hugging Face Space, free CPU: 2 vCPU / 16 GB).
# The code comes from GitHub on every start, so updates there arrive with a restart (and hourly).
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1 HF_HOME=/home/user/.cache/huggingface \
    REPO=https://github.com/GuhanathanG/Youtube-Analytics.git
WORKDIR /home/user

# Install everything once at build time (fast restarts). The CPU-only torch keeps the image small.
RUN git clone --depth 1 "$REPO" app \
 && pip install --no-cache-dir --user -r app/requirements.txt \
 && pip install --no-cache-dir --user torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --user -r app/requirements-ai.txt

EXPOSE 7860
CMD ["bash", "-c", "cd app && (git pull --ff-only -q || true) && exec bash deploy/huggingface/run.sh"]
