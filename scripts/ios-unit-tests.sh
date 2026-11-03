#!/usr/bin/env bash
# The iOS tests on a simulator of their own, on the newest iOS runtime,
# booted before the tests start and deleted afterwards. By default the unit
# tests (ByokyTests; release.sh and CI's ios-unit job); with --ui the UI
# tests (ByokyUITests) without the marketing screenshot walk (the iOS UI
# workflow). It needs the built Safari extension in packages/ios
# (copy-wxt-output.sh), like the app does.
#
# Usage: scripts/ios-unit-tests.sh <derived data dir> [--quiet] [--ui]
# SIM_NAME names the simulator (default byoky-unit-tests-<pid>).
# SIM_DEVICE_TYPE picks the iPhone, e.g. iPhone-SE-3rd-generation (default
# iPhone-17); when the runtime doesn't have it, its newest iPhone.
# RESULT_BUNDLE is where xcodebuild writes the .xcresult.
#
# Ad-hoc signing, not CODE_SIGNING_ALLOWED=NO: the keychain tests need the
# entitlements a signed test host carries, or they fail with -34018.
set -euo pipefail
cd "$(dirname "$0")/.."

DERIVED="${1:?Usage: scripts/ios-unit-tests.sh <derived data dir> [--quiet] [--ui]}"
shift
QUIET=()
TESTS=(-only-testing:ByokyTests)
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=(-quiet) ;;
    --ui) TESTS=(-only-testing:ByokyUITests -skip-testing:ByokyUITests/ByokyMarketingTests) ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

# A fixed iPhone, so a run doesn't depend on the order the runtime lists its
# devices in (newest first; the last is the oldest).
pick=$(xcrun simctl list runtimes -j | WANT="${SIM_DEVICE_TYPE:-iPhone-17}" node -e '
  const runtimes = JSON.parse(require("fs").readFileSync(0)).runtimes
    .filter((r) => r.platform === "iOS" && r.isAvailable)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
  const phones = runtimes[0]?.supportedDeviceTypes?.filter((d) => d.productFamily === "iPhone") ?? []
  const want = process.env.WANT
  const phone = phones.find((d) => d.identifier === want || d.identifier.endsWith("." + want)) ?? phones[0]
  if (phone) console.log(runtimes[0].identifier, phone.identifier)
')
if [ -z "$pick" ]; then echo "No iOS simulator runtime with an iPhone is installed"; exit 1; fi
echo "Simulator: ${pick#* } on ${pick%% *}"
udid=$(xcrun simctl create "${SIM_NAME:-byoky-unit-tests-$$}" "${pick#* }" "${pick%% *}")
LOG=$(mktemp)
trap 'xcrun simctl delete "$udid" >/dev/null 2>&1 || true; rm -f "$LOG"' EXIT

# On a simulator still booting, the first test run fails now and then with
# "Simulator device failed to launch com.byoky.app"; boot it and wait.
xcrun simctl bootstatus "$udid" -b

ARGS=(
  -project packages/ios/Byoky.xcodeproj -scheme Byoky "${TESTS[@]}"
  -destination "id=$udid" -derivedDataPath "$DERIVED"
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=
)
if [ -n "${RESULT_BUNDLE:-}" ]; then
  rm -rf "$RESULT_BUNDLE"
  ARGS+=(-resultBundlePath "$RESULT_BUNDLE")
fi
if xcodebuild test "${ARGS[@]}" ${QUIET[@]+"${QUIET[@]}"} 2>&1 | tee "$LOG"; then
  exit 0
fi
# That launch failure still happens on a booted simulator at times. The build
# is fine, so run the tests once more without building; any other failure
# stands.
if grep -q 'Simulator device failed to launch' "$LOG"; then
  echo "The simulator failed to launch the test host; running the tests once more."
  if [ -n "${RESULT_BUNDLE:-}" ]; then rm -rf "$RESULT_BUNDLE"; fi
  xcodebuild test-without-building "${ARGS[@]}" ${QUIET[@]+"${QUIET[@]}"}
else
  exit 1
fi
