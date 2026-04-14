#!/usr/bin/env bash
#
# Full-stack interactive e2e — the widest coverage the repo can give.
#
# Runs every interactive spec in sequence:
#
#   Phase 1 — Demo playground (desktop-only):
#     Drives the real /demo Playground (Chat / Tool Use / Structured Output /
#     Backend Relay) against a live extension wallet with real API keys.
#     Covers streaming, vision, tool-use, json_schema, and the ByokyServer
#     mock-ws pair. No device needed.
#
#   Phase 2 — iOS full matrix (5 sub-stages):
#     FS  — desktop gifts anthropic; iOS auto-fires firePayload=stream.
#     FV  — desktop gifts anthropic; iOS auto-fires firePayload=vision.
#     FT  — desktop gifts anthropic; iOS auto-fires firePayload=tools.
#     FO  — desktop gifts openai;    iOS auto-fires firePayload=structured.
#     FDP — iOS gifts gemini; desktop walletB redeems, drives /demo Chat
#           tab through the iOS relay.
#
#   Phase 3 — Android full matrix (5 sub-stages):
#     Same shape as Phase 2 (AFS/AFV/AFT/AFO/AFDP) against an Android
#     emulator via adb + logcat.
#
#   Phase 4 — Vault chain:
#     Live vault.byoky.com signup → credential upload → vault-backed gift
#     mint → sender goes offline → receiver redeems via vault fallback →
#     receiver drives /demo streaming + vision + tools through vault →
#     sender reopens and sees usedTokens > 0.
#
# Starts the Next.js /demo dev server on :3000 at the start (unless
# BYOKY_DEMO_URL points elsewhere or --skip-demo is passed) and kills it
# at the end. Prereqs: .env.local with ANTHROPIC/OPENAI/GEMINI keys, a
# booted iPhone simulator, a booted Android emulator, byoky-bridge on PATH.
#
# Usage:
#   ./scripts/run-interactive-full-stack.sh --check
#   ./scripts/run-interactive-full-stack.sh
#   ./scripts/run-interactive-full-stack.sh --only-demo
#   ./scripts/run-interactive-full-stack.sh --only-ios
#   ./scripts/run-interactive-full-stack.sh --only-android
#   ./scripts/run-interactive-full-stack.sh --only-vault
#   ./scripts/run-interactive-full-stack.sh --skip-demo --skip-vault

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
E2E_DIR="$REPO_ROOT/e2e"
IOS_DIR="$REPO_ROOT/packages/ios"
ANDROID_DIR="$REPO_ROOT/packages/android"
ENV_FILE="$REPO_ROOT/.env.local"

# ─── Sentinels (shared with iOS + Android full specs) ─────────────
IOS_CONFIG_FILE="/tmp/byoky-ios-test-config.json"
IOS_GIFT_LINK="/tmp/byoky-ios-gift-link.txt"
IOS_DONE_SIGNAL="/tmp/byoky-ios-done.sig"
IOS_PROXY_RESULT="/tmp/byoky-ios-proxy-result.json"

ANDROID_PKG="com.byoky.app"
ANDROID_DEVICE_CONFIG="/data/local/tmp/byoky-test-config.json"
ANDROID_DEVICE_LINK_IN="/data/local/tmp/byoky-desktop-gift-link.txt"
ANDROID_DEVICE_DONE_SIG="/data/local/tmp/byoky-android-done.sig"
ANDROID_DEVICE_PROXY_DONE_SIG="/data/local/tmp/byoky-android-proxy-done.sig"
ANDROID_GIFT_LINK="/tmp/byoky-android-gift-link.txt"
ANDROID_PROXY_RESULT="/tmp/byoky-android-proxy-result.json"
HOST_DESKTOP_GIFT_LINK="/tmp/byoky-desktop-gift-link.txt"

SIM_NAME="${BYOKY_IOS_SIM:-iPhone 17 Pro}"
DEMO_URL="${BYOKY_DEMO_URL:-http://localhost:3000/demo}"

# ─── Flags ────────────────────────────────────────────────────────
CHECK_ONLY=0
SKIP_BUILD=0
SKIP_DEMO=0
SKIP_IOS=0
SKIP_ANDROID=0
SKIP_VAULT=0
for arg in "$@"; do
  case "$arg" in
    --check)         CHECK_ONLY=1 ;;
    --skip-build)    SKIP_BUILD=1 ;;
    --skip-demo)     SKIP_DEMO=1 ;;
    --skip-ios)      SKIP_IOS=1 ;;
    --skip-android)  SKIP_ANDROID=1 ;;
    --skip-vault)    SKIP_VAULT=1 ;;
    --only-demo)     SKIP_IOS=1; SKIP_ANDROID=1; SKIP_VAULT=1 ;;
    --only-ios)      SKIP_DEMO=1; SKIP_ANDROID=1; SKIP_VAULT=1 ;;
    --only-android)  SKIP_DEMO=1; SKIP_IOS=1; SKIP_VAULT=1 ;;
    --only-vault)    SKIP_DEMO=1; SKIP_IOS=1; SKIP_ANDROID=1 ;;
    -h|--help)       grep '^#' "$0" | sed 's/^# //; s/^#//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

EVENT_LOG=$(mktemp -t byoky-full-stack-recap)
record() { echo "$(date +%H:%M:%S)  $*" | tee -a "$EVENT_LOG"; }

# ─── Prereq check ─────────────────────────────────────────────────
if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "==> Checking full-stack prerequisites"
  FAIL=0
  ok()   { echo "  ok    $1"; }
  miss() { echo "  MISS  $1"; echo "        → $2"; FAIL=$((FAIL + 1)); }
  [[ -f "$ENV_FILE" ]] && ok ".env.local exists" || miss ".env.local exists" "create $ENV_FILE with API keys"
  for k in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY; do
    if grep -q "^$k=" "$ENV_FILE" 2>/dev/null; then ok "$k set"
    else miss "$k set" "add $k=… to .env.local"; fi
  done
  command -v byoky-bridge >/dev/null \
    && ok "byoky-bridge on PATH" \
    || miss "byoky-bridge on PATH" "pnpm --filter @byoky/bridge build && npm link"
  if [[ "$SKIP_IOS" -eq 0 ]]; then
    command -v xcrun >/dev/null && ok "xcrun present" || miss "xcrun present" "install Xcode command line tools"
    if xcrun simctl list devices booted 2>/dev/null | grep -q "$SIM_NAME"; then
      ok "iOS simulator '$SIM_NAME' booted"
    else
      miss "iOS simulator '$SIM_NAME' booted" "xcrun simctl boot '$SIM_NAME'"
    fi
  fi
  if [[ "$SKIP_ANDROID" -eq 0 ]]; then
    command -v adb >/dev/null && ok "adb on PATH" || miss "adb on PATH" "brew install android-platform-tools"
    if [[ $(adb devices 2>/dev/null | grep -c "device$") -ge 1 ]]; then
      ok "Android emulator/device connected"
    else
      miss "Android emulator/device connected" "boot an emulator via Android Studio or emulator CLI"
    fi
  fi
  [[ -d "$REPO_ROOT/packages/extension/.output/chrome-mv3" ]] \
    && ok "extension built" \
    || miss "extension built" "pnpm build"
  if [[ "$SKIP_DEMO" -eq 0 ]]; then
    if curl -fs --max-time 2 "$DEMO_URL" >/dev/null 2>&1; then
      ok "/demo reachable at $DEMO_URL"
    else
      echo "  info  /demo will be auto-started (pnpm -C packages/web dev)"
    fi
  fi
  echo
  if [[ $FAIL -eq 0 ]]; then echo "All checks passed."; exit 0; else echo "$FAIL check(s) failed."; exit 1; fi
fi

# ─── Setup ────────────────────────────────────────────────────────
[[ -f "$ENV_FILE" ]] || { echo "error: $ENV_FILE missing" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
for v in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY; do
  [[ -n "${!v:-}" ]] || { echo "error: $v missing from $ENV_FILE" >&2; exit 1; }
done

# Optional build. Each per-phase block may also build its own simulator.
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  record "==> pnpm build (extension + sdk + core + web)"
  (cd "$REPO_ROOT" && pnpm build) || { record "pnpm build failed"; exit 1; }
fi

DEMO_PID=""
start_demo_if_needed() {
  if curl -fs --max-time 2 "$DEMO_URL" >/dev/null 2>&1; then
    record "==> /demo already reachable at $DEMO_URL — reusing existing server"
    return
  fi
  record "==> starting /demo (pnpm -C packages/web dev) in background"
  (cd "$REPO_ROOT/packages/web" && pnpm dev >/tmp/byoky-demo-dev.log 2>&1) &
  DEMO_PID=$!
  for _ in $(seq 1 60); do
    if curl -fs --max-time 2 "$DEMO_URL" >/dev/null 2>&1; then
      record "==> /demo ready at $DEMO_URL (pid $DEMO_PID)"
      return
    fi
    sleep 1
  done
  record "error: /demo never came up. Tail /tmp/byoky-demo-dev.log for details."
  return 1
}

stop_demo() {
  if [[ -n "$DEMO_PID" ]] && kill -0 "$DEMO_PID" 2>/dev/null; then
    record "==> stopping /demo (pid $DEMO_PID)"
    kill "$DEMO_PID" 2>/dev/null
    wait "$DEMO_PID" 2>/dev/null
  fi
}
trap stop_demo EXIT

# ─── Phase 1 — Demo playground ────────────────────────────────────
DEMO_EXIT=0
if [[ "$SKIP_DEMO" -eq 0 ]]; then
  record "═══ Phase 1: Demo playground (desktop-only matrix)"
  start_demo_if_needed || { DEMO_EXIT=1; }
  if [[ $DEMO_EXIT -eq 0 ]]; then
    (cd "$E2E_DIR" && BYOKY_DEMO_URL="$DEMO_URL" npx playwright test tests/demo-playground.spec.ts) \
      > /tmp/byoky-demo-playground.log 2>&1
    DEMO_EXIT=$?
    if [[ $DEMO_EXIT -eq 0 ]]; then record "Phase 1 OK"; else record "Phase 1 FAIL (exit=$DEMO_EXIT, see /tmp/byoky-demo-playground.log)"; fi
  fi
else
  record "Phase 1: skipped (--skip-demo)"
fi

# ─── Phase 2 — iOS full matrix ────────────────────────────────────
IOS_RESULTS=()
run_ios_stage() {
  # $1=stage tag (FS|FV|FT|FO|FDP), $2=config JSON for iOS, $3=ios test class#method,
  # $4=wait_mode: "result" (wait for PROXY_RESULT) or "gift" (wait for IOS_GIFT_LINK + Playwright leads)
  local tag="$1" config="$2" xctest="$3" wait_mode="$4"
  record "──── iOS stage $tag"
  rm -f "$IOS_GIFT_LINK" "$IOS_DONE_SIGNAL" "$IOS_PROXY_RESULT" "$HOST_DESKTOP_GIFT_LINK"
  xcrun simctl terminate "$SIM_NAME" com.byoky.app 2>/dev/null
  echo "$config" > "$IOS_CONFIG_FILE"

  local xc_log="/tmp/byoky-ios-${tag}-xcuitest.log"
  local pw_log="/tmp/byoky-ios-${tag}-playwright.log"

  if [[ "$wait_mode" == "result" ]]; then
    # Desktop-sender flow: Playwright writes gift link, iOS auto-fires on redemption.
    (cd "$E2E_DIR" && BYOKY_STAGE="$tag" BYOKY_DEMO_URL="$DEMO_URL" \
      npx playwright test tests/interactive-cross-device-full.spec.ts) > "$pw_log" 2>&1 &
    local pw_pid=$!

    # Wait for Playwright to drop the gift link, then start iOS test that
    # redeems it. Similar to stage 2 of run-interactive-cross-device.sh.
    for _ in $(seq 1 180); do
      [[ -s "$HOST_DESKTOP_GIFT_LINK" ]] && break
      sleep 0.5
    done
    if [[ ! -s "$HOST_DESKTOP_GIFT_LINK" ]]; then
      record "iOS $tag FAIL: Playwright never produced gift link"
      kill $pw_pid 2>/dev/null; IOS_RESULTS+=("$tag:FAIL"); return 1
    fi
    (cd "$IOS_DIR" && xcodebuild test-without-building \
      -project Byoky.xcodeproj -scheme Byoky \
      -destination "platform=iOS Simulator,name=$SIM_NAME" \
      -only-testing:"ByokyUITests/ByokyInteractiveCrossDeviceTests/$xctest") > "$xc_log" 2>&1 &
    local xc_pid=$!

    wait $pw_pid; local pw_exit=$?
    wait $xc_pid; local xc_exit=$?
    if [[ $pw_exit -eq 0 && $xc_exit -eq 0 ]]; then
      record "iOS $tag OK"; IOS_RESULTS+=("$tag:OK")
    else
      record "iOS $tag FAIL (pw=$pw_exit xctest=$xc_exit; pw=$pw_log xc=$xc_log)"
      IOS_RESULTS+=("$tag:FAIL")
    fi
  else
    # iOS-sender flow (FDP only): iOS creates gift, Playwright drives /demo.
    (cd "$IOS_DIR" && xcodebuild test-without-building \
      -project Byoky.xcodeproj -scheme Byoky \
      -destination "platform=iOS Simulator,name=$SIM_NAME" \
      -only-testing:"ByokyUITests/ByokyInteractiveCrossDeviceTests/$xctest") > "$xc_log" 2>&1 &
    local xc_pid=$!
    for _ in $(seq 1 240); do
      [[ -s "$IOS_GIFT_LINK" ]] && break
      sleep 0.5
    done
    if [[ ! -s "$IOS_GIFT_LINK" ]]; then
      record "iOS $tag FAIL: sim never produced gift link"
      kill $xc_pid 2>/dev/null; IOS_RESULTS+=("$tag:FAIL"); return 1
    fi

    (cd "$E2E_DIR" && BYOKY_STAGE="$tag" BYOKY_DEMO_URL="$DEMO_URL" \
      npx playwright test tests/interactive-cross-device-full.spec.ts) > "$pw_log" 2>&1
    local pw_exit=$?
    # Playwright writes done signal; ensure sim also exits cleanly.
    [[ ! -f "$IOS_DONE_SIGNAL" ]] && touch "$IOS_DONE_SIGNAL"
    wait $xc_pid; local xc_exit=$?
    if [[ $pw_exit -eq 0 ]]; then
      record "iOS $tag OK (xctest exit=$xc_exit)"; IOS_RESULTS+=("$tag:OK")
    else
      record "iOS $tag FAIL (pw=$pw_exit xctest=$xc_exit; pw=$pw_log xc=$xc_log)"
      IOS_RESULTS+=("$tag:FAIL")
    fi
  fi
}

IOS_BUILD_OK=1
if [[ "$SKIP_IOS" -eq 0 ]]; then
  record "═══ Phase 2: iOS full matrix"
  start_demo_if_needed

  # xcodegen is cheap and required whenever a Swift file is added or
  # removed from the UI-test target; always run it so -only-testing
  # doesn't silently match zero tests.
  record "==> regenerate iOS Xcode project (xcodegen)"
  (cd "$IOS_DIR" && xcodegen >/dev/null) || { record "xcodegen failed"; IOS_BUILD_OK=0; }

  # Build the app + UI-test bundle once so the per-stage loop can use
  # test-without-building and avoid rebuilding (which would take ~40s per
  # stage × 5 stages = 3min of dead time).
  if [[ "$IOS_BUILD_OK" -eq 1 ]]; then
    record "==> xcodebuild build-for-testing (iOS Simulator)"
    (cd "$IOS_DIR" && xcodebuild build-for-testing \
      -project Byoky.xcodeproj \
      -scheme Byoky \
      -destination "platform=iOS Simulator,name=$SIM_NAME" \
      >/tmp/byoky-ios-build.log 2>&1) || { record "iOS build failed (see /tmp/byoky-ios-build.log)"; IOS_BUILD_OK=0; }
  fi
fi

if [[ "$SKIP_IOS" -eq 0 && "$IOS_BUILD_OK" -eq 1 ]]; then
  # Desktop-sender stages — each maps a (provider, firePayload) to a fire config.
  run_ios_stage "FS" \
    "{\"password\":\"CrossDeviceFull1234!\",\"fireAfterSetup\":\"anthropic\",\"firePayload\":\"stream\"}" \
    "testIOSRedeemsGift_Interactive" "result"
  sleep 6
  run_ios_stage "FV" \
    "{\"password\":\"CrossDeviceFull1234!\",\"fireAfterSetup\":\"anthropic\",\"firePayload\":\"vision\"}" \
    "testIOSRedeemsGift_Interactive" "result"
  sleep 6
  run_ios_stage "FT" \
    "{\"password\":\"CrossDeviceFull1234!\",\"fireAfterSetup\":\"anthropic\",\"firePayload\":\"tools\"}" \
    "testIOSRedeemsGift_Interactive" "result"
  sleep 6
  run_ios_stage "FO" \
    "{\"password\":\"CrossDeviceFull1234!\",\"fireAfterSetup\":\"openai\",\"firePayload\":\"structured\"}" \
    "testIOSRedeemsGift_Interactive" "result"
  sleep 6
  # iOS-sender stage: sim creates the gift, desktop drives /demo.
  run_ios_stage "FDP" \
    "{\"geminiKey\":\"$GEMINI_API_KEY\",\"password\":\"CrossDeviceFull1234!\"}" \
    "testIOSSendsGift_Interactive" "gift"
else
  record "Phase 2: skipped (--skip-ios)"
fi

# ─── Phase 3 — Android full matrix ────────────────────────────────
ANDROID_RESULTS=()
if [[ "$SKIP_ANDROID" -eq 0 ]]; then
  record "═══ Phase 3: Android full matrix"
  start_demo_if_needed

  ADB_DEVICE=$(adb devices | awk '/device$/{print $1; exit}')
  if [[ -z "$ADB_DEVICE" ]]; then
    record "Phase 3 FAIL: no Android device connected"
    ANDROID_RESULTS+=("SETUP:FAIL")
  else
    ADB="adb -s $ADB_DEVICE"
    record "==> using Android device: $ADB_DEVICE"

    # Install APKs once.
    (cd "$ANDROID_DIR" && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest 2>&1 | tail -3) \
      || record "gradle assemble warning (continuing)"
    $ADB install -r -t "$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk" >/dev/null
    $ADB install -r -t "$ANDROID_DIR/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" >/dev/null

    run_android_stage() {
      local tag="$1" config="$2" klass_method="$3" wait_mode="$4"
      record "──── Android stage $tag"
      $ADB shell pm clear "$ANDROID_PKG" >/dev/null
      $ADB shell rm -f "$ANDROID_DEVICE_CONFIG" "$ANDROID_DEVICE_LINK_IN" "$ANDROID_DEVICE_DONE_SIG" "$ANDROID_DEVICE_PROXY_DONE_SIG" 2>/dev/null
      rm -f "$ANDROID_GIFT_LINK" "$ANDROID_PROXY_RESULT" "$HOST_DESKTOP_GIFT_LINK"
      echo "$config" > /tmp/byoky-android-test-config.json
      $ADB push /tmp/byoky-android-test-config.json "$ANDROID_DEVICE_CONFIG" >/dev/null

      local logcat_log="/tmp/byoky-android-${tag}-logcat.txt"
      local inst_log="/tmp/byoky-android-${tag}-instrument.log"
      local pw_log="/tmp/byoky-android-${tag}-playwright.log"
      $ADB logcat -c
      $ADB logcat -s BYOKY_TEST:I AndroidRuntime:E *:S > "$logcat_log" 2>&1 &
      local logcat_pid=$!

      if [[ "$wait_mode" == "result" ]]; then
        (cd "$E2E_DIR" && BYOKY_STAGE="$tag" BYOKY_DEMO_URL="$DEMO_URL" \
          npx playwright test tests/interactive-cross-device-android-full.spec.ts) > "$pw_log" 2>&1 &
        local pw_pid=$!
        for _ in $(seq 1 180); do
          [[ -s "$HOST_DESKTOP_GIFT_LINK" ]] && break
          sleep 0.5
        done
        if [[ ! -s "$HOST_DESKTOP_GIFT_LINK" ]]; then
          record "Android $tag FAIL: Playwright never produced gift link"
          kill $pw_pid $logcat_pid 2>/dev/null; ANDROID_RESULTS+=("$tag:FAIL"); return
        fi
        $ADB push "$HOST_DESKTOP_GIFT_LINK" "$ANDROID_DEVICE_LINK_IN" >/dev/null
        $ADB shell am instrument -w -e class "com.byoky.app.${klass_method}" -e configFile "$ANDROID_DEVICE_CONFIG" \
          "${ANDROID_PKG}.test/androidx.test.runner.AndroidJUnitRunner" > "$inst_log" 2>&1 &
        local inst_pid=$!
        for _ in $(seq 1 360); do
          grep -q "PROXY_RESULT=" "$logcat_log" 2>/dev/null && break
          sleep 0.5
        done
        if grep -q "PROXY_RESULT=" "$logcat_log"; then
          grep -o "PROXY_RESULT={.*}" "$logcat_log" | head -1 | sed 's/^PROXY_RESULT=//' > "$ANDROID_PROXY_RESULT"
          $ADB shell "echo done > $ANDROID_DEVICE_PROXY_DONE_SIG"
        fi
        wait $pw_pid; local pw_exit=$?
        wait $inst_pid; local inst_exit=$?
        kill $logcat_pid 2>/dev/null
        if [[ $pw_exit -eq 0 ]]; then
          record "Android $tag OK (instrument exit=$inst_exit)"; ANDROID_RESULTS+=("$tag:OK")
        else
          record "Android $tag FAIL (pw=$pw_exit inst=$inst_exit; pw=$pw_log inst=$inst_log)"
          ANDROID_RESULTS+=("$tag:FAIL")
        fi
      else
        # Android-sender: AFDP
        $ADB shell am instrument -w -e class "com.byoky.app.${klass_method}" -e configFile "$ANDROID_DEVICE_CONFIG" \
          "${ANDROID_PKG}.test/androidx.test.runner.AndroidJUnitRunner" > "$inst_log" 2>&1 &
        local inst_pid=$!
        for _ in $(seq 1 240); do
          grep -q "GIFT_LINK=" "$logcat_log" 2>/dev/null && break
          sleep 0.5
        done
        if ! grep -q "GIFT_LINK=" "$logcat_log"; then
          record "Android $tag FAIL: device never logged GIFT_LINK="
          kill $inst_pid $logcat_pid 2>/dev/null; ANDROID_RESULTS+=("$tag:FAIL"); return
        fi
        grep -o "GIFT_LINK=[^ ]*" "$logcat_log" | head -1 | sed 's/^GIFT_LINK=//' > "$ANDROID_GIFT_LINK"
        (cd "$E2E_DIR" && BYOKY_STAGE="$tag" BYOKY_DEMO_URL="$DEMO_URL" \
          npx playwright test tests/interactive-cross-device-android-full.spec.ts) > "$pw_log" 2>&1
        local pw_exit=$?
        $ADB shell "echo done > $ANDROID_DEVICE_DONE_SIG"
        wait $inst_pid; local inst_exit=$?
        kill $logcat_pid 2>/dev/null
        if [[ $pw_exit -eq 0 ]]; then
          record "Android $tag OK"; ANDROID_RESULTS+=("$tag:OK")
        else
          record "Android $tag FAIL (pw=$pw_exit inst=$inst_exit)"; ANDROID_RESULTS+=("$tag:FAIL")
        fi
      fi
    }

    run_android_stage "AFS" \
      "{\"password\":\"CrossDeviceFull1234!\",\"fireAfterSetup\":\"anthropic\",\"firePayload\":\"stream\",\"redeemLinkFile\":\"$ANDROID_DEVICE_LINK_IN\"}" \
      "AndroidInteractiveCrossDeviceTest#testAndroidRedeemsGift_Interactive" "result"
    sleep 6
    run_android_stage "AFV" \
      "{\"password\":\"CrossDeviceFull1234!\",\"fireAfterSetup\":\"anthropic\",\"firePayload\":\"vision\",\"redeemLinkFile\":\"$ANDROID_DEVICE_LINK_IN\"}" \
      "AndroidInteractiveCrossDeviceTest#testAndroidRedeemsGift_Interactive" "result"
    sleep 6
    run_android_stage "AFT" \
      "{\"password\":\"CrossDeviceFull1234!\",\"fireAfterSetup\":\"anthropic\",\"firePayload\":\"tools\",\"redeemLinkFile\":\"$ANDROID_DEVICE_LINK_IN\"}" \
      "AndroidInteractiveCrossDeviceTest#testAndroidRedeemsGift_Interactive" "result"
    sleep 6
    run_android_stage "AFO" \
      "{\"password\":\"CrossDeviceFull1234!\",\"fireAfterSetup\":\"openai\",\"firePayload\":\"structured\",\"redeemLinkFile\":\"$ANDROID_DEVICE_LINK_IN\"}" \
      "AndroidInteractiveCrossDeviceTest#testAndroidRedeemsGift_Interactive" "result"
    sleep 6
    run_android_stage "AFDP" \
      "{\"password\":\"CrossDeviceFull1234!\",\"geminiKey\":\"$GEMINI_API_KEY\"}" \
      "AndroidInteractiveCrossDeviceTest#testAndroidSendsGift_Interactive" "gift"
  fi
else
  record "Phase 3: skipped (--skip-android)"
fi

# ─── Phase 4 — Vault chain ────────────────────────────────────────
VAULT_EXIT=0
if [[ "$SKIP_VAULT" -eq 0 ]]; then
  record "═══ Phase 4: Vault chain (live vault.byoky.com)"
  start_demo_if_needed
  (cd "$E2E_DIR" && BYOKY_DEMO_URL="$DEMO_URL" \
    npx playwright test tests/interactive-vault-chain.spec.ts) > /tmp/byoky-vault-chain.log 2>&1
  VAULT_EXIT=$?
  if [[ $VAULT_EXIT -eq 0 ]]; then record "Phase 4 OK"; else record "Phase 4 FAIL (see /tmp/byoky-vault-chain.log)"; fi
else
  record "Phase 4: skipped (--skip-vault)"
fi

# ─── Recap ────────────────────────────────────────────────────────
echo
echo "═══════════════════════════════════════════════════════════════"
echo " Full-stack interactive e2e — recap"
echo "═══════════════════════════════════════════════════════════════"
cat "$EVENT_LOG"
rm -f "$EVENT_LOG"
echo "─────────────────────────────── iOS stage results:"
for r in "${IOS_RESULTS[@]+"${IOS_RESULTS[@]}"}"; do echo "   $r"; done
echo "─────────────────────────────── Android stage results:"
for r in "${ANDROID_RESULTS[@]+"${ANDROID_RESULTS[@]}"}"; do echo "   $r"; done
echo "═══════════════════════════════════════════════════════════════"

# Exit code: 0 only if every requested phase passed.
FAIL=0
[[ "$SKIP_DEMO" -eq 0 && "$DEMO_EXIT" -ne 0 ]] && FAIL=1
for r in "${IOS_RESULTS[@]+"${IOS_RESULTS[@]}"}";         do [[ "$r" == *:FAIL ]] && FAIL=1; done
for r in "${ANDROID_RESULTS[@]+"${ANDROID_RESULTS[@]}"}"; do [[ "$r" == *:FAIL ]] && FAIL=1; done
[[ "$SKIP_VAULT" -eq 0 && "$VAULT_EXIT" -ne 0 ]] && FAIL=1
exit $FAIL
