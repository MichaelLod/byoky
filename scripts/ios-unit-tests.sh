#!/usr/bin/env bash
# The iOS unit tests (ByokyTests) on a simulator of their own: an iPhone on
# the newest iOS runtime, booted before the tests start and deleted
# afterwards. release.sh and CI's ios-unit job run it. It needs the built
# Safari extension in packages/ios (copy-wxt-output.sh), like the app does.
#
# Usage: scripts/ios-unit-tests.sh <derived data dir> [--quiet]
# SIM_NAME names the simulator (default byoky-unit-tests-<pid>).
#
# Ad-hoc signing, not CODE_SIGNING_ALLOWED=NO: the keychain tests need the
# entitlements a signed test host carries, or they fail with -34018.
set -euo pipefail
cd "$(dirname "$0")/.."

DERIVED="${1:?Usage: scripts/ios-unit-tests.sh <derived data dir> [--quiet]}"
QUIET=()
if [ "${2:-}" = --quiet ]; then QUIET=(-quiet); fi

pick=$(xcrun simctl list runtimes -j | node -e '
  const runtimes = JSON.parse(require("fs").readFileSync(0)).runtimes
    .filter((r) => r.platform === "iOS" && r.isAvailable)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
  const phone = runtimes[0]?.supportedDeviceTypes?.filter((d) => d.productFamily === "iPhone").pop()
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
  -project packages/ios/Byoky.xcodeproj -scheme Byoky -only-testing:ByokyTests
  -destination "id=$udid" -derivedDataPath "$DERIVED"
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=
)
if xcodebuild test "${ARGS[@]}" ${QUIET[@]+"${QUIET[@]}"} 2>&1 | tee "$LOG"; then
  exit 0
fi
# That launch failure still happens on a booted simulator at times. The build
# is fine, so run the tests once more without building; any other failure
# stands.
if grep -q 'Simulator device failed to launch' "$LOG"; then
  echo "The simulator failed to launch the test host; running the tests once more."
  xcodebuild test-without-building "${ARGS[@]}" ${QUIET[@]+"${QUIET[@]}"}
else
  exit 1
fi
