#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$(cd ../../.. && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "FAIL: $ENV_FILE not found — the real-bridge test needs ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY) from there." >&2
  exit 1
fi

# Build + pack the local workspace packages so the Dockerfile installs the
# in-progress code instead of whatever is on npm.
BUILD_DIR="./_local_pkgs"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

( cd "$REPO_ROOT" && pnpm install --filter @byoky/bridge --filter @byoky/openclaw-plugin >/dev/null )
( cd "$REPO_ROOT/packages/bridge" && pnpm build >/dev/null )
( cd "$REPO_ROOT/packages/openclaw-plugin" && pnpm build >/dev/null )

# pnpm pack substitutes `workspace:*` with the concrete version so the tarball
# is installable by plain npm inside the Docker image.
( cd "$REPO_ROOT/packages/bridge" && pnpm pack --pack-destination "$REPO_ROOT/packages/openclaw-plugin/test-docker/$BUILD_DIR" >/dev/null )
( cd "$REPO_ROOT/packages/openclaw-plugin" && pnpm pack --pack-destination "$REPO_ROOT/packages/openclaw-plugin/test-docker/$BUILD_DIR" >/dev/null )

docker build -t byoky-openclaw-test .
# -t allocates a pseudo-TTY; OpenClaw's `models auth login` refuses to run
# without one. --env-file passes real API keys from .env.local at runtime so
# they are never baked into the image.
docker run --rm -t --env-file "$ENV_FILE" byoky-openclaw-test

rm -rf "$BUILD_DIR"
