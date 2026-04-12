#!/usr/bin/env bash
#
# Cross-device e2e: iOS simulator as gift sender, desktop extension
# (Playwright) as gift recipient.
#
# Stages:
#   1. Load API keys from e2e/.env.local so both sides can find the Gemini key.
#   2. Run the iOS XCUITest ByokyCrossDeviceTests — creates a gift on the
#      iPhone simulator and writes the link to /tmp/byoky-ios-gift-link.txt.
#   3. Run the Playwright spec cross-device-ios-sender.spec.ts — reads the
#      link, spins up a desktop extension wallet, redeems the gift, and
#      probes the sender.
#
# Today the test at the final step is expected to fail (Linear COD-13 —
# iOS never registers as role: sender on the relay, so the desktop
# recipient sees the sender as offline). The assertion is marked
# `.fixme` in the spec so the suite as a whole still exits green.
#
# Usage:
#   ./scripts/run-cross-device-ios.sh [--skip-ios] [--skip-desktop]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$REPO_ROOT/packages/ios"
E2E_DIR="$REPO_ROOT/e2e"
# Live fixtures read the repo-root .env.local (see e2e/fixtures.ts).
ENV_FILE="$REPO_ROOT/.env.local"
GIFT_LINK_FILE="/tmp/byoky-ios-gift-link.txt"
SIM_NAME="${BYOKY_IOS_SIM:-iPhone 17 Pro}"

SKIP_IOS=0
SKIP_DESKTOP=0
for arg in "$@"; do
  case "$arg" in
    --skip-ios) SKIP_IOS=1 ;;
    --skip-desktop) SKIP_DESKTOP=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# //; s/^#//'; exit 0 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found — the iOS + desktop halves both need real API keys" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "error: GEMINI_API_KEY missing from $ENV_FILE" >&2
  exit 1
fi

# Clean any link left behind by a prior run so the desktop side can't
# accidentally redeem stale state.
rm -f "$GIFT_LINK_FILE"

if [[ "$SKIP_IOS" -eq 0 ]]; then
  echo "==> iOS: running ByokyCrossDeviceTests on '$SIM_NAME'"

  # xcodebuild's TEST_RUNNER_* env forwarding is finicky for UI test hosts,
  # so we hand off secrets via a plain JSON file on disk. Same Mac, same
  # filesystem. The file is written just before the test and deleted after.
  CONFIG_FILE="/tmp/byoky-ios-test-config.json"
  cat > "$CONFIG_FILE" <<JSON
{
  "geminiKey": "$GEMINI_API_KEY",
  "giftLinkOut": "$GIFT_LINK_FILE"
}
JSON
  chmod 600 "$CONFIG_FILE"

  (
    cd "$IOS_DIR"
    # Ensure the project is in sync with project.yml in case accessibility
    # identifiers were added since the last generate.
    xcodegen >/dev/null
    xcodebuild test \
      -project Byoky.xcodeproj \
      -scheme Byoky \
      -destination "platform=iOS Simulator,name=$SIM_NAME" \
      -only-testing:ByokyUITests/ByokyCrossDeviceTests \
      2>&1 | tail -150
  )

  rm -f "$CONFIG_FILE"
else
  echo "==> iOS: skipped (--skip-ios)"
fi

if [[ ! -s "$GIFT_LINK_FILE" ]]; then
  echo "error: $GIFT_LINK_FILE missing or empty — the iOS XCUITest did not emit a gift link" >&2
  exit 1
fi

echo "==> iOS: gift link written"
head -c 80 "$GIFT_LINK_FILE"; echo

if [[ "$SKIP_DESKTOP" -eq 0 ]]; then
  echo "==> desktop: running Playwright recipient spec"
  (
    cd "$E2E_DIR"
    BYOKY_GIFT_LINK_IN="$GIFT_LINK_FILE" \
      npx playwright test tests/cross-device-ios-sender.spec.ts
  )
else
  echo "==> desktop: skipped (--skip-desktop)"
fi

echo "==> cross-device run finished"
