#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$(cd ../../.. && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "FAIL: $ENV_FILE not found — the real-bridge test needs ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY) from there." >&2
  exit 1
fi

docker build -t byoky-openclaw-test .
# -t allocates a pseudo-TTY; OpenClaw's `models auth login` refuses to run
# without one. --env-file passes real API keys from .env.local at runtime so
# they are never baked into the image.
docker run --rm -t --env-file "$ENV_FILE" byoky-openclaw-test
