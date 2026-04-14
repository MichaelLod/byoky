#!/usr/bin/env bash
#
# Interactive cross-device e2e: Chrome extension ↔ Android emulator.
#
# Mirrors scripts/run-interactive-cross-device.sh (iOS). Same two-stage
# shape — Android sends gift then desktop sends gift — wired up via adb
# push for host→device sentinels and `adb logcat -s BYOKY_TEST` for
# device→host events.
#
# Stage 1 — Android sends Gemini gift, desktop redeems + makes real call:
#   * UI Automator test boots, auto-setup imports the Gemini key, drives
#     Gifts → Create Gift → Custom amount=500 → submit, reads the link
#     off the success screen, emits `BYOKY_TEST GIFT_LINK=…` via Log.i,
#     blocks on /data/local/tmp/byoky-android-done.sig.
#   * Playwright (BYOKY_STAGE=A1) sets up walletA + 3 real demo calls,
#     then walletB redeems the link, fires real Gemini through the
#     gift-relay back to the Android emulator. On success it touches
#     the done sentinel.
#
# Stage 2 — desktop sends Anthropic gift, Android redeems + auto-fires:
#   * Config rewritten with anthropic + fireAfterSetup. UI Automator
#     test pastes the desktop link into Redeem Gift, accepts. The app's
#     TestSupport coroutine polls for the redeemed gift then issues a
#     real claude-haiku-4-5 request via ProxyService.proxyRequest;
#     result lands on logcat as `BYOKY_TEST PROXY_RESULT={…}`.
#   * Playwright (BYOKY_STAGE=A2) waits for that JSON and asserts.
#
# Usage:
#   ./scripts/run-interactive-cross-device-android.sh --check
#   ./scripts/run-interactive-cross-device-android.sh
#   ./scripts/run-interactive-cross-device-android.sh --skip-build
#   ./scripts/run-interactive-cross-device-android.sh --skip-stage1
#   ./scripts/run-interactive-cross-device-android.sh --skip-stage2

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/packages/android"
E2E_DIR="$REPO_ROOT/e2e"
ENV_FILE="$REPO_ROOT/.env.local"

PKG="com.byoky.app"
DEVICE_CONFIG="/data/local/tmp/byoky-test-config.json"
DEVICE_LINK_IN="/data/local/tmp/byoky-desktop-gift-link.txt"
DEVICE_DONE_SIG="/data/local/tmp/byoky-android-done.sig"
DEVICE_PROXY_DONE_SIG="/data/local/tmp/byoky-android-proxy-done.sig"

HOST_ANDROID_GIFT_LINK="/tmp/byoky-android-gift-link.txt"
HOST_DESKTOP_GIFT_LINK="/tmp/byoky-desktop-gift-link.txt"
HOST_PROXY_RESULT="/tmp/byoky-android-proxy-result.json"
HOST_LOCAL_CONFIG="/tmp/byoky-android-test-config.json"
STAGE1_LOG="/tmp/byoky-android-stage1.log"
STAGE1_LOGCAT="/tmp/byoky-android-stage1-logcat.txt"
STAGE2_LOG="/tmp/byoky-android-stage2.log"
STAGE2_LOGCAT="/tmp/byoky-android-stage2-logcat.txt"
STAGE1_INSTRUMENT_LOG="/tmp/byoky-android-stage1-instrument.log"
STAGE2_INSTRUMENT_LOG="/tmp/byoky-android-stage2-instrument.log"

SKIP_BUILD=0
SKIP_STAGE1=0
SKIP_STAGE2=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-stage1) SKIP_STAGE1=1 ;;
    --skip-stage2) SKIP_STAGE2=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# //; s/^#//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "==> Checking prerequisites"
  FAIL=0
  ok() { echo "  ok    $1"; }
  miss() { echo "  MISS  $1"; echo "        → $2"; FAIL=$((FAIL + 1)); }
  if [[ -f "$ENV_FILE" ]]; then ok ".env.local exists"; else miss ".env.local exists" "create $ENV_FILE with API keys"; fi
  for k in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY; do
    if grep -q "^$k=" "$ENV_FILE" 2>/dev/null; then ok "$k set"; else miss "$k set" "add $k=… to .env.local"; fi
  done
  if command -v adb >/dev/null; then ok "adb on PATH"; else miss "adb on PATH" "brew install android-platform-tools"; fi
  if [[ $(adb devices 2>/dev/null | grep -c "device$") -ge 1 ]]; then
    ok "Android emulator/device connected"
  else
    miss "Android emulator/device connected" "boot one with: ~/Library/Android/sdk/emulator/emulator -avd Medium_Phone_API_36.1"
  fi
  if [[ -x "$ANDROID_DIR/gradlew" ]]; then ok "gradlew present"; else miss "gradlew present" "ensure packages/android/gradlew is executable"; fi
  if [[ -d "$REPO_ROOT/packages/extension/.output/chrome-mv3" ]]; then ok "extension built"; else miss "extension built" "pnpm build (or omit --skip-build)"; fi
  echo
  if [[ $FAIL -eq 0 ]]; then echo "All checks passed."; exit 0; else echo "$FAIL check(s) failed."; exit 1; fi
fi

if [[ ! -f "$ENV_FILE" ]]; then echo "error: $ENV_FILE missing" >&2; exit 1; fi
set -a; source "$ENV_FILE"; set +a
for v in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY; do
  if [[ -z "${!v:-}" ]]; then echo "error: $v missing from $ENV_FILE" >&2; exit 1; fi
done

DEVICE=$(adb devices | awk '/device$/{print $1; exit}')
if [[ -z "$DEVICE" ]]; then
  echo "error: no Android device/emulator connected (adb devices)" >&2
  exit 1
fi
ADB="adb -s $DEVICE"
echo "==> using android device: $DEVICE"

# Clean stale state
rm -f "$HOST_ANDROID_GIFT_LINK" "$HOST_DESKTOP_GIFT_LINK" "$HOST_PROXY_RESULT" \
      "$HOST_LOCAL_CONFIG" "$STAGE1_LOG" "$STAGE1_LOGCAT" "$STAGE2_LOG" \
      "$STAGE2_LOGCAT" "$STAGE1_INSTRUMENT_LOG" "$STAGE2_INSTRUMENT_LOG"
$ADB shell rm -f "$DEVICE_CONFIG" "$DEVICE_LINK_IN" "$DEVICE_DONE_SIG" "$DEVICE_PROXY_DONE_SIG" 2>/dev/null

EVENT_LOG=$(mktemp -t byoky-android-recap)
record() { echo "$(date +%H:%M:%S)  $*" | tee -a "$EVENT_LOG"; }

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  record "==> build extension + sdk + core (pnpm build)"
  (cd "$REPO_ROOT" && pnpm build) || { record "build failed"; exit 1; }
else
  record "==> skipping pnpm build (--skip-build)"
fi

# Gradle assemble + install always runs — the test APK has to be on the
# device, and gradle's incremental build skips work when nothing changed.
record "==> assembling Android debug APKs"
(cd "$ANDROID_DIR" && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest 2>&1 | tail -5) \
  || { record "gradle assemble failed"; exit 1; }
record "==> installing app + test APK on $DEVICE"
$ADB install -r -t "$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
$ADB install -r -t "$ANDROID_DIR/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" >/dev/null

write_config() {
  echo "$1" > "$HOST_LOCAL_CONFIG"
  $ADB push "$HOST_LOCAL_CONFIG" "$DEVICE_CONFIG" >/dev/null
}

start_logcat_watch() {
  # $1: output file
  $ADB logcat -c
  $ADB logcat -s BYOKY_TEST:I AndroidRuntime:E *:S > "$1" 2>&1 &
  echo $!
}

run_instrument() {
  # $1: test method (e.g. AndroidInteractiveCrossDeviceTest#testAndroidSendsGift_Interactive)
  # $2: log file
  $ADB shell am instrument -w \
    -e class "com.byoky.app.${1}" \
    -e configFile "$DEVICE_CONFIG" \
    "${PKG}.test/androidx.test.runner.AndroidJUnitRunner" \
    > "$2" 2>&1
}

run_playwright() {
  # $1: stage label (A1 or A2), $2: log file
  (cd "$E2E_DIR" && BYOKY_STAGE="$1" npx playwright test tests/interactive-cross-device-android.spec.ts) \
    > "$2" 2>&1
}

# ─── Stage 1 — Android as sender ──────────────────────────────────

STAGE1_DESKTOP_EXIT=0
STAGE1_DEVICE_EXIT=0
if [[ "$SKIP_STAGE1" -eq 0 ]]; then
  record "==> Stage 1: Android creates Gemini gift, desktop redeems + proxies"
  # Mirrors iOS -byokyResetOnLaunch: wipe app data so wallet starts
  # uninitialized and TestSupport.autoSetupIfNeeded actually creates the
  # password + imports the key.
  $ADB shell pm clear "$PKG" >/dev/null
  write_config "{\"geminiKey\":\"$GEMINI_API_KEY\",\"password\":\"CrossDevice1234!\"}"

  LOGCAT_PID=$(start_logcat_watch "$STAGE1_LOGCAT")
  record "Stage 1: launching UI Automator testAndroidSendsGift_Interactive"
  run_instrument "AndroidInteractiveCrossDeviceTest#testAndroidSendsGift_Interactive" "$STAGE1_INSTRUMENT_LOG" &
  INSTRUMENT_PID=$!

  # Watch logcat for GIFT_LINK= in a bounded loop. 2 minutes max.
  record "Stage 1: waiting for Android to log GIFT_LINK="
  for _ in $(seq 1 240); do
    if grep -q "GIFT_LINK=" "$STAGE1_LOGCAT" 2>/dev/null; then break; fi
    sleep 0.5
  done
  if grep -q "GIFT_LINK=" "$STAGE1_LOGCAT"; then
    grep -o "GIFT_LINK=[^ ]*" "$STAGE1_LOGCAT" | head -1 | sed 's/^GIFT_LINK=//' > "$HOST_ANDROID_GIFT_LINK"
    record "Stage 1: Android gift link ready: $(head -c 60 "$HOST_ANDROID_GIFT_LINK")…"

    record "Stage 1: launching Playwright (BYOKY_STAGE=A1)"
    run_playwright A1 "$STAGE1_LOG"
    STAGE1_DESKTOP_EXIT=$?
    if [[ $STAGE1_DESKTOP_EXIT -eq 0 ]]; then
      record "Stage 1 OK: Playwright passed — Android sender released by spec"
    else
      record "Stage 1 FAIL: Playwright exit=$STAGE1_DESKTOP_EXIT (see $STAGE1_LOG)"
    fi
    # Always release the device test so the emulator doesn't hang.
    $ADB shell "echo done > $DEVICE_DONE_SIG"
    wait $INSTRUMENT_PID
    STAGE1_DEVICE_EXIT=$?
    if [[ $STAGE1_DEVICE_EXIT -ne 0 ]]; then
      record "Stage 1 FAIL: instrument exit=$STAGE1_DEVICE_EXIT (see $STAGE1_INSTRUMENT_LOG)"
    fi
  else
    record "Stage 1 FAIL: Android never logged GIFT_LINK= within 2min"
    STAGE1_DEVICE_EXIT=1
    kill $INSTRUMENT_PID 2>/dev/null
  fi
  kill $LOGCAT_PID 2>/dev/null
else
  record "==> Stage 1: skipped (--skip-stage1)"
fi

if [[ "$SKIP_STAGE1" -eq 0 && "$SKIP_STAGE2" -eq 0 ]]; then
  record "==> settling delay between stages (8s — relay socket cleanup)"
  sleep 8
fi

# ─── Stage 2 — desktop as sender, Android as recipient ────────────

STAGE2_DESKTOP_EXIT=0
STAGE2_DEVICE_EXIT=0
if [[ "$SKIP_STAGE2" -eq 0 ]]; then
  record "==> Stage 2: desktop creates Anthropic gift, Android redeems + auto-fires"
  # Same reset: Stage 2 starts from a clean wallet so autoSetup creates
  # the password and the recipient socket starts fresh.
  $ADB shell pm clear "$PKG" >/dev/null
  # autoSetup will read redeemLinkFile and call wallet.redeemGift directly
  # — bypasses the UI typing layer (which mangles the URL via input text).
  write_config "{\"password\":\"CrossDevice1234!\",\"fireAfterSetup\":\"anthropic\",\"redeemLinkFile\":\"$DEVICE_LINK_IN\"}"
  $ADB shell rm -f "$DEVICE_LINK_IN" "$DEVICE_PROXY_DONE_SIG" 2>/dev/null

  LOGCAT_PID=$(start_logcat_watch "$STAGE2_LOGCAT")

  record "Stage 2: launching Playwright (BYOKY_STAGE=A2) in background"
  run_playwright A2 "$STAGE2_LOG" &
  PLAY_PID=$!

  record "Stage 2: waiting for Playwright to drop $HOST_DESKTOP_GIFT_LINK"
  for _ in $(seq 1 180); do
    [[ -s "$HOST_DESKTOP_GIFT_LINK" ]] && break
    sleep 0.5
  done
  if [[ -s "$HOST_DESKTOP_GIFT_LINK" ]]; then
    record "Stage 2: desktop gift link ready: $(head -c 60 "$HOST_DESKTOP_GIFT_LINK")…"
    $ADB push "$HOST_DESKTOP_GIFT_LINK" "$DEVICE_LINK_IN" >/dev/null

    record "Stage 2: launching UI Automator testAndroidRedeemsGift_Interactive"
    run_instrument "AndroidInteractiveCrossDeviceTest#testAndroidRedeemsGift_Interactive" "$STAGE2_INSTRUMENT_LOG" &
    INSTRUMENT_PID=$!

    # Watch logcat for PROXY_RESULT= up to 3 min.
    record "Stage 2: watching logcat for PROXY_RESULT="
    for _ in $(seq 1 360); do
      if grep -q "PROXY_RESULT=" "$STAGE2_LOGCAT" 2>/dev/null; then break; fi
      sleep 0.5
    done
    if grep -q "PROXY_RESULT=" "$STAGE2_LOGCAT"; then
      grep -o "PROXY_RESULT={.*}" "$STAGE2_LOGCAT" | head -1 | sed 's/^PROXY_RESULT=//' > "$HOST_PROXY_RESULT"
      record "Stage 2: PROXY_RESULT captured to $HOST_PROXY_RESULT"
      # Tell device test it can exit
      $ADB shell "echo done > $DEVICE_PROXY_DONE_SIG"
    else
      record "Stage 2 WARN: no PROXY_RESULT= in logcat after 3min"
    fi

    wait $PLAY_PID
    STAGE2_DESKTOP_EXIT=$?
    if [[ $STAGE2_DESKTOP_EXIT -ne 0 ]]; then
      record "Stage 2 FAIL: Playwright exit=$STAGE2_DESKTOP_EXIT (see $STAGE2_LOG)"
    else
      record "Stage 2 OK: Playwright asserted Android proxy result"
    fi
    wait $INSTRUMENT_PID
    STAGE2_DEVICE_EXIT=$?
    if [[ $STAGE2_DEVICE_EXIT -ne 0 ]]; then
      record "Stage 2 FAIL: instrument exit=$STAGE2_DEVICE_EXIT (see $STAGE2_INSTRUMENT_LOG)"
    fi
  else
    record "Stage 2 FAIL: Playwright never produced gift link"
    STAGE2_DESKTOP_EXIT=1
    kill $PLAY_PID 2>/dev/null
  fi
  kill $LOGCAT_PID 2>/dev/null
else
  record "==> Stage 2: skipped (--skip-stage2)"
fi

# Cleanup
$ADB shell rm -f "$DEVICE_CONFIG" "$DEVICE_LINK_IN" "$DEVICE_DONE_SIG" "$DEVICE_PROXY_DONE_SIG" 2>/dev/null

# ─── Recap ────────────────────────────────────────────────────────

echo
echo "═══════════════════════════════════════════════════════════════"
echo " Android cross-device run — step-by-step recap"
echo "═══════════════════════════════════════════════════════════════"
cat "$EVENT_LOG"
rm -f "$EVENT_LOG"
echo "═══════════════════════════════════════════════════════════════"
echo " Logs:"
[[ -f "$STAGE1_INSTRUMENT_LOG" ]] && echo "   Stage 1 device:   $STAGE1_INSTRUMENT_LOG"
[[ -f "$STAGE1_LOGCAT" ]]        && echo "   Stage 1 logcat:   $STAGE1_LOGCAT"
[[ -f "$STAGE1_LOG" ]]           && echo "   Stage 1 desktop:  $STAGE1_LOG"
[[ -f "$STAGE2_INSTRUMENT_LOG" ]] && echo "   Stage 2 device:   $STAGE2_INSTRUMENT_LOG"
[[ -f "$STAGE2_LOGCAT" ]]        && echo "   Stage 2 logcat:   $STAGE2_LOGCAT"
[[ -f "$STAGE2_LOG" ]]           && echo "   Stage 2 desktop:  $STAGE2_LOG"
if [[ -f "$HOST_PROXY_RESULT" ]]; then
  echo "   Android proxy result JSON:"
  sed 's/^/     /' "$HOST_PROXY_RESULT"
fi
echo "═══════════════════════════════════════════════════════════════"

if [[ $STAGE1_DESKTOP_EXIT -eq 0 && $STAGE1_DEVICE_EXIT -eq 0 && $STAGE2_DESKTOP_EXIT -eq 0 && $STAGE2_DEVICE_EXIT -eq 0 ]]; then
  exit 0
fi
exit 1
