#!/bin/sh
# Stand-in for xdg-open: the plugin's auth flow opens a local URL in a browser
# so the page can talk to the Byoky extension. In this test we have no extension,
# so we fetch the auth page (smoke test that it renders) and then POST the
# callback directly with the providers we want OpenClaw to think the wallet has.

set -e

URL="$1"
echo "[fake-browser] received URL: $URL" >&2

curl -fsS "$URL" > /dev/null

PROVIDER="${BYOKY_TEST_PROVIDER:-anthropic}"
BRIDGE_PORT="${BRIDGE_PORT:-19280}"

curl -fsS -X POST "$URL/callback" \
  -H 'Content-Type: application/json' \
  -d "{\"providers\":[\"$PROVIDER\"],\"bridgePort\":$BRIDGE_PORT}" \
  > /dev/null

echo "[fake-browser] posted callback (provider=$PROVIDER bridgePort=$BRIDGE_PORT)" >&2
