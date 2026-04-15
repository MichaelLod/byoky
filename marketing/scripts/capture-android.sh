#!/bin/bash
# Capture Android emulator screens for marketing.
#
# Requires: an Android emulator with the Byoky app installed and visible via
# `adb devices`. The e2e Android interactive test already installs and walks
# through onboarding -> dashboard -> create gift -> redeem.
#
# Output: marketing/raw/android/ at emulator native resolution (typically
# 1080×1920 for Pixel-class emulators — Google Play phone-portrait spec).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${ROOT}/marketing/raw/android"
mkdir -p "${OUT}"

if ! command -v adb >/dev/null 2>&1; then
  echo "✗ adb not on PATH. Install Android platform-tools."
  exit 1
fi

DEVICE="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "${DEVICE}" ]; then
  echo "✗ No Android device/emulator visible via adb. Boot an emulator first."
  exit 1
fi
echo "✓ Using device ${DEVICE}"

snap() {
  local name="$1"
  adb -s "${DEVICE}" shell screencap -p > "${OUT}/${name}.png"
  echo "  📸 ${name}.png"
}

# Launch the app
adb -s "${DEVICE}" shell am start -n com.byoky.app/.MainActivity || true
sleep 4
snap "01-onboarding"

# Run the interactive android test in background; tap-and-snap between phases
(
  cd "${ROOT}"
  ./scripts/run-interactive-cross-device-android.sh > "${OUT}/_run.log" 2>&1 &
  echo $! > /tmp/byoky-marketing-android-runner.pid
)

sleep 5 && snap "02-dashboard-empty"
sleep 5 && snap "03-add-credential"
sleep 6 && snap "04-dashboard-with-key"
sleep 6 && snap "05-create-gift"
sleep 6 && snap "06-gift-link-shared"
sleep 6 && snap "07-redeem-gift"
sleep 6 && snap "08-dashboard-final"

if [ -f /tmp/byoky-marketing-android-runner.pid ]; then
  kill "$(cat /tmp/byoky-marketing-android-runner.pid)" 2>/dev/null || true
  rm -f /tmp/byoky-marketing-android-runner.pid
fi

echo ""
echo "✓ Android frames written to ${OUT}/"
ls -lh "${OUT}/"*.png
