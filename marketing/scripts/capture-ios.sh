#!/bin/bash
# Capture iOS sim screens for marketing by running ByokyMarketingTests
# (a slim XCUITest that walks the app through every store-worthy screen,
# pausing on each so this script can snap via `xcrun simctl io screenshot`).
#
# Requires: a booted iOS simulator with the Byoky app installed.
# Defaults to BYOKY_IOS_SIM="iPhone 17 Pro".
#
# Output: marketing/raw/ios/<phase>.png at sim native resolution (1320×2868
# for iPhone 17 Pro = App Store 6.9" portrait spec). The phase names come
# from packages/ios/ByokyUITests/ByokyMarketingTests.swift:
#
#   01-welcome          onboarding
#   02-dashboard        wallet with the auto-setup Gemini key
#   03-settings-backup  Settings (wallet toolbar), encrypted .byoky backup on top
#   03b-export-backup   Export Backup sheet
#   04-apps-empty       Apps tab, nothing added yet
#   05-add-app-form     add an app by URL (byoky.com/chat)
#   06-app-runtime      the app running in the in-wallet browser
#   07-apps-grid        Apps tab with the added app
#   08-connected-apps   Connected tab (sessions + routing groups)
#   09-dashboard-final  back on the wallet
#
# compose.ts consumes these names; EXPECTED_FRAMES below warns when a frame
# the test should produce didn't get captured.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${ROOT}/marketing/raw/ios"
SIM_NAME="${BYOKY_IOS_SIM:-iPhone 17 Pro}"
IOS_DIR="${ROOT}/packages/ios"
ENV_FILE="${ROOT}/.env.local"
CONFIG="/tmp/byoky-ios-test-config.json"
PHASE_FILE="/tmp/byoky-mkt-phase.txt"
ACK_FILE="/tmp/byoky-mkt-snapped"
TEST_LOG="${OUT}/_test.log"
EXPECTED_FRAMES=(01-welcome 02-dashboard 03-settings-backup 03b-export-backup 04-apps-empty 05-add-app-form 06-app-runtime 07-apps-grid 08-connected-apps 09-dashboard-final)

mkdir -p "${OUT}"
rm -f "${PHASE_FILE}" "${ACK_FILE}" "${OUT}"/*.png

# Resolve sim UDID
UDID="$(xcrun simctl list devices booted | awk -F'[()]' "/${SIM_NAME}/{print \$2; exit}")"
if [ -z "${UDID}" ]; then
  echo "✗ No booted iOS simulator named '${SIM_NAME}'."
  echo "  Boot one with:  xcrun simctl boot \"${SIM_NAME}\""
  exit 1
fi
echo "✓ Using simulator ${SIM_NAME} (${UDID})"

# Load API keys from .env.local
if [ ! -f "${ENV_FILE}" ]; then
  echo "✗ Missing ${ENV_FILE} (need GEMINI_API_KEY for auto-setup)" >&2
  exit 1
fi
set -a; source "${ENV_FILE}"; set +a
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "✗ GEMINI_API_KEY missing in ${ENV_FILE}" >&2
  exit 1
fi

# Write the auto-setup config (just gemini — single provider keeps the test fast)
cat > "${CONFIG}" <<JSON
{
  "geminiKey": "${GEMINI_API_KEY}",
  "password": "MarketingDemo!2026"
}
JSON
chmod 600 "${CONFIG}"

# Regen Xcode project so xcodebuild sees ByokyMarketingTests.swift
if command -v xcodegen >/dev/null 2>&1; then
  echo "→ regenerating Xcode project (xcodegen)"
  (cd "${IOS_DIR}" && xcodegen >/dev/null) || { echo "✗ xcodegen failed"; exit 1; }
else
  echo "⚠ xcodegen not on PATH — skipping (relying on existing project)"
fi

# Launch the marketing test in the background
echo "→ launching XCUITest ByokyMarketingTests in background (build may take a min)..."
xcodebuild test \
  -project "${IOS_DIR}/Byoky.xcodeproj" \
  -scheme Byoky \
  -destination "platform=iOS Simulator,id=${UDID}" \
  -only-testing:"ByokyUITests/ByokyMarketingTests/testCaptureMarketingScreens" \
  > "${TEST_LOG}" 2>&1 &
TEST_PID=$!

# Poll the phase file. Each new value → snap with that name → ack.
echo "→ polling for phase changes..."
LAST_PHASE=""
DEADLINE=$(($(date +%s) + 600))   # 10 min cap
SNAPPED_COUNT=0

cleanup() {
  kill "${TEST_PID}" 2>/dev/null || true
  rm -f "${PHASE_FILE}" "${ACK_FILE}"
}
trap cleanup EXIT

while [ $(date +%s) -lt $DEADLINE ]; do
  # Bail if test process died
  if ! kill -0 "${TEST_PID}" 2>/dev/null; then
    break
  fi

  if [ -f "${PHASE_FILE}" ]; then
    PHASE="$(cat "${PHASE_FILE}" 2>/dev/null | tr -d '\n')"
    if [ -n "${PHASE}" ] && [ "${PHASE}" != "${LAST_PHASE}" ]; then
      if [ "${PHASE}" = "DONE" ]; then
        echo "  ✓ test signalled DONE"
        break
      fi
      sleep 0.3   # let the UI finish rendering before the snap
      xcrun simctl io "${UDID}" screenshot "${OUT}/${PHASE}.png" >/dev/null 2>&1 || true
      echo "  📸 ${PHASE}.png"
      touch "${ACK_FILE}"
      LAST_PHASE="${PHASE}"
      SNAPPED_COUNT=$((SNAPPED_COUNT + 1))
    fi
  fi
  sleep 0.2
done

# Wait briefly for test to wrap up
wait "${TEST_PID}" 2>/dev/null
TEST_RC=$?

echo ""
echo "✓ Snapped ${SNAPPED_COUNT} iOS frames to ${OUT}/"
ls -1 "${OUT}"/*.png 2>/dev/null | xargs -I{} basename {} 2>/dev/null
for f in "${EXPECTED_FRAMES[@]}"; do
  [ -f "${OUT}/${f}.png" ] || echo "⚠ missing ${f}.png (compose skips any slide that uses it)"
done
echo ""
if [ ${TEST_RC} -ne 0 ]; then
  echo "⚠ XCUITest exit code ${TEST_RC} — see ${TEST_LOG} for details"
  echo "   tail: $(tail -5 "${TEST_LOG}" | tr '\n' ' ')"
fi
exit 0
