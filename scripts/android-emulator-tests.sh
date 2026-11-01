#!/usr/bin/env bash
# The Android app on an emulator: the instrumented tests (androidTest; the
# live-provider ones skip without BYOKY_TEST_*_KEY) and the Maestro UI flows
# in packages/android/maestro. CI's android-emulator job runs it. Locally,
# start an emulator first, and set ANDROID_SERIAL when more than one device
# is connected (gradle and Maestro both use it).
#
# Usage: scripts/android-emulator-tests.sh [output dir]
# The output dir (default build/android-emulator-tests) gets Maestro's JUnit
# report and its screenshots and logs; gradle's reports stay in
# packages/android/app/build/reports/androidTests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mkdir -p "${1:-$ROOT/build/android-emulator-tests}" && cd "${1:-$ROOT/build/android-emulator-tests}" && pwd)"
cd "$ROOT/packages/android"

./gradlew :app:connectedDebugAndroidTest --console=plain

# connectedDebugAndroidTest uninstalls the app when it's done; the flows
# launch the installed one.
./gradlew :app:installDebug --console=plain

# The flows only store the keys they type and send nothing, so live-flow
# takes dummy ones; onboarding-flow and wallet-flow need none.
cd maestro
maestro test ${ANDROID_SERIAL:+--device "$ANDROID_SERIAL"} \
  --format junit --output "$OUT/maestro-report.xml" \
  --debug-output "$OUT/maestro-debug" --flatten-debug-output \
  -e ANTHROPIC_API_KEY=sk-ant-maestro-dummy \
  -e OPENAI_API_KEY=sk-maestro-dummy \
  -e GEMINI_API_KEY=AIza-maestro-dummy \
  onboarding-flow.yaml wallet-flow.yaml live-flow.yaml
