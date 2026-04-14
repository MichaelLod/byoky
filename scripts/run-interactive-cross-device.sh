#!/usr/bin/env bash
#
# Interactive cross-device e2e: Chrome extension ↔ iPhone simulator.
#
# Runs both directions of the gift flow plus a small live-flow subset on
# the desktop side, using real API keys from .env.local. Uses real money
# at real provider APIs; budgets are capped at 500 tokens per gift and
# 32 max_tokens per auto-fire request.
#
# Two stages, each runs in parallel with a matching XCUITest so the relay
# WebSocket is live for both sides:
#
#   Stage 1 — iOS sends gift:
#     * XCUITest `testIOSSendsGift_Interactive` boots the sim, creates
#       a 500-token Gemini gift, writes the link to
#       /tmp/byoky-ios-gift-link.txt, blocks on /tmp/byoky-ios-done.sig.
#     * Playwright spec (BYOKY_STAGE=1) sets up walletA (imports all
#       three keys, runs a real demo call for each), then walletB
#       redeems the iOS link, connects demo with gemini-only, and makes
#       a real Gemini call through the gift relay. On success it drops
#       the done signal so the sim can exit.
#
#   Stage 2 — desktop sends gift:
#     * Config gets rewritten with anthropicKey + fireAfterSetup:
#       "anthropic". When the iOS app auto-setup sees fireAfterSetup it
#       spawns a detached Task that waits for a gifted credential and
#       then fires a real anthropic request through proxyViaGiftRelay.
#     * Playwright spec (BYOKY_STAGE=2) mints a 500-token Anthropic gift
#       on walletA and writes the link to
#       /tmp/byoky-desktop-gift-link.txt.
#     * XCUITest `testIOSRedeemsGift_Interactive` pastes that link into
#       the iOS Redeem Gift sheet, accepts it, and waits for the
#       auto-fire result JSON.
#     * Playwright reads the result JSON and asserts success + that
#       walletA's sent gift shows usedTokens > 0.
#
# At the end prints a step-by-step recap so you can eyeball what
# happened at each step without having to read the raw logs.
#
# Usage:
#   ./scripts/run-interactive-cross-device.sh --check      (validate prereqs, no run)
#   ./scripts/run-interactive-cross-device.sh              (full run)
#   ./scripts/run-interactive-cross-device.sh --skip-build
#   ./scripts/run-interactive-cross-device.sh --skip-stage1
#   ./scripts/run-interactive-cross-device.sh --skip-stage2

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$REPO_ROOT/packages/ios"
E2E_DIR="$REPO_ROOT/e2e"
ENV_FILE="$REPO_ROOT/.env.local"

SIM_NAME="${BYOKY_IOS_SIM:-iPhone 17 Pro}"
CONFIG_FILE="/tmp/byoky-ios-test-config.json"
IOS_GIFT_LINK="/tmp/byoky-ios-gift-link.txt"
DESKTOP_GIFT_LINK="/tmp/byoky-desktop-gift-link.txt"
IOS_DONE_SIGNAL="/tmp/byoky-ios-done.sig"
IOS_PROXY_RESULT="/tmp/byoky-ios-proxy-result.json"
STAGE1_LOG="/tmp/byoky-stage1-desktop.log"
STAGE1_IOS_LOG="/tmp/byoky-stage1-ios.log"
STAGE2_LOG="/tmp/byoky-stage2-desktop.log"
STAGE2_IOS_LOG="/tmp/byoky-stage2-ios.log"

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

# ─── --check: validate prerequisites without running anything ──────
if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "==> Checking prerequisites"
  FAIL=0
  check() {
    # $1: description, $2: shell test, $3: remediation hint
    if eval "$2" >/dev/null 2>&1; then
      echo "  ok    $1"
    else
      echo "  MISS  $1"
      echo "        → $3"
      FAIL=$((FAIL + 1))
    fi
  }

  check ".env.local exists" "[[ -f '$ENV_FILE' ]]" \
    "Create $ENV_FILE with ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY"
  check "ANTHROPIC_API_KEY set" "grep -q '^ANTHROPIC_API_KEY=' '$ENV_FILE'" \
    "Add ANTHROPIC_API_KEY=sk-ant-… to .env.local"
  check "OPENAI_API_KEY set" "grep -q '^OPENAI_API_KEY=' '$ENV_FILE'" \
    "Add OPENAI_API_KEY=sk-… to .env.local"
  check "GEMINI_API_KEY set" "grep -q '^GEMINI_API_KEY=' '$ENV_FILE'" \
    "Add GEMINI_API_KEY=… to .env.local"
  check "xcodegen installed" "command -v xcodegen" \
    "brew install xcodegen"
  check "xcrun available" "command -v xcrun" \
    "Install Xcode from the App Store"
  check "simulator '$SIM_NAME' exists" \
    "xcrun simctl list devices available | grep -q '$SIM_NAME ('" \
    "xcrun simctl list devices available — pick one, set BYOKY_IOS_SIM=<name>"
  check "pnpm installed" "command -v pnpm" \
    "npm i -g pnpm"
  check "byoky-bridge on PATH" "command -v byoky-bridge" \
    "pnpm --filter @byoky/bridge build && (cd packages/bridge && npm link)"
  check "extension built" "[[ -d '$REPO_ROOT/packages/extension/.output/chrome-mv3' ]]" \
    "pnpm build (or let the orchestrator do it — skip --skip-build)"
  check "Playwright Chromium cached" \
    "ls '$HOME/Library/Caches/ms-playwright' 2>/dev/null | grep -q chromium" \
    "cd e2e && npx playwright install chromium"

  echo
  if [[ $FAIL -eq 0 ]]; then
    echo "All checks passed. Run without --check to execute."
    exit 0
  else
    echo "$FAIL check(s) failed — fix above, then rerun --check."
    exit 1
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found — need ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY" >&2
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

for var in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "error: $var missing from $ENV_FILE" >&2
    exit 1
  fi
done

# Clean stale handoff files so we can't accidentally pick up data from a
# previous run partway through.
rm -f "$IOS_GIFT_LINK" "$DESKTOP_GIFT_LINK" "$IOS_DONE_SIGNAL" "$IOS_PROXY_RESULT"

# Track a human-readable event log so the final recap has real content.
EVENT_LOG=$(mktemp -t byoky-recap)
record() { echo "$(date +%H:%M:%S)  $*" | tee -a "$EVENT_LOG"; }

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  record "==> build extension + sdk + core"
  (cd "$REPO_ROOT" && pnpm build) || { record "build failed"; exit 1; }
else
  record "==> skipping extension/sdk build (--skip-build)"
fi

# xcodegen is cheap and is required whenever a Swift file is added/removed
# from the UI-test target — always run it, even with --skip-build, otherwise
# `-only-testing:` silently matches 0 tests and the stage looks "hung".
record "==> regenerate iOS Xcode project (xcodegen)"
(cd "$IOS_DIR" && xcodegen >/dev/null) || { record "xcodegen failed"; exit 1; }

write_config() {
  # $1: JSON body
  cat > "$CONFIG_FILE" <<JSON
$1
JSON
  chmod 600 "$CONFIG_FILE"
}

run_xcuitest() {
  # $1: test class/method (e.g. ByokyUITests/ByokyInteractiveCrossDeviceTests/testIOSSendsGift_Interactive)
  # $2: log file
  xcodebuild test \
    -project "$IOS_DIR/Byoky.xcodeproj" \
    -scheme Byoky \
    -destination "platform=iOS Simulator,name=$SIM_NAME" \
    -only-testing:"$1" \
    > "$2" 2>&1
  local rc=$?
  # xcodebuild returns 0 even when -only-testing matched zero tests — the
  # test bundle was built but no test method ran. Surface that so we don't
  # sit waiting for a sentinel file that will never appear.
  if grep -q "Executed 0 tests" "$2"; then
    record "  XCUITest ran 0 tests — is $1 registered in Byoky.xcodeproj? (run xcodegen)"
    return 2
  fi
  return $rc
}

run_playwright() {
  # $1: stage number, $2: log file
  (cd "$E2E_DIR" && BYOKY_STAGE="$1" npx playwright test tests/interactive-cross-device.spec.ts) \
    > "$2" 2>&1
}

# ─────────────────────────────────────────────────────────────────────
# Stage 1 — iOS as sender, desktop as recipient
# ─────────────────────────────────────────────────────────────────────

STAGE1_DESKTOP_EXIT=0
STAGE1_IOS_EXIT=0
if [[ "$SKIP_STAGE1" -eq 0 ]]; then
  record "==> Stage 1: iOS creates Gemini gift, desktop redeems + proxies a real Gemini call"
  write_config "$(cat <<JSON
{
  "geminiKey": "$GEMINI_API_KEY",
  "password": "CrossDevice1234!"
}
JSON
)"

  record "Stage 1: launching XCUITest testIOSSendsGift_Interactive (sim: $SIM_NAME)"
  run_xcuitest "ByokyUITests/ByokyInteractiveCrossDeviceTests/testIOSSendsGift_Interactive" "$STAGE1_IOS_LOG" &
  IOS_PID=$!

  # Wait up to 2 min for iOS to drop the gift link.
  record "Stage 1: waiting for iOS to drop $IOS_GIFT_LINK"
  for _ in $(seq 1 240); do
    [[ -s "$IOS_GIFT_LINK" ]] && break
    sleep 0.5
  done
  if [[ ! -s "$IOS_GIFT_LINK" ]]; then
    record "Stage 1 FAIL: iOS never produced a gift link (see $STAGE1_IOS_LOG)"
    kill "$IOS_PID" 2>/dev/null || true
    STAGE1_IOS_EXIT=1
  else
    record "Stage 1: iOS gift link ready: $(head -c 60 "$IOS_GIFT_LINK")…"
    record "Stage 1: launching Playwright (BYOKY_STAGE=1)"
    run_playwright 1 "$STAGE1_LOG"
    STAGE1_DESKTOP_EXIT=$?
    if [[ $STAGE1_DESKTOP_EXIT -ne 0 ]]; then
      record "Stage 1 FAIL: Playwright exit=$STAGE1_DESKTOP_EXIT (see $STAGE1_LOG)"
      # Make sure we still release the iOS test so the sim doesn't hang.
      echo done > "$IOS_DONE_SIGNAL"
    else
      record "Stage 1 OK: Playwright passed — iOS sender was signalled by the spec"
    fi
    wait "$IOS_PID"
    STAGE1_IOS_EXIT=$?
    if [[ $STAGE1_IOS_EXIT -ne 0 ]]; then
      record "Stage 1 FAIL: XCUITest exit=$STAGE1_IOS_EXIT (see $STAGE1_IOS_LOG)"
    fi
  fi
else
  record "==> Stage 1: skipped (--skip-stage1)"
fi

# Let any relay sockets from Stage 1 finish closing before Stage 2 starts.
# Without this we sometimes hit "recipient already connected" on the next
# gift's auth because the relay server hasn't noticed the old TCP close yet.
if [[ "$SKIP_STAGE1" -eq 0 && "$SKIP_STAGE2" -eq 0 ]]; then
  record "==> settling delay between stages (8s — relay socket cleanup)"
  sleep 8
fi

# ─────────────────────────────────────────────────────────────────────
# Stage 2 — desktop as sender, iOS as recipient
# ─────────────────────────────────────────────────────────────────────

STAGE2_DESKTOP_EXIT=0
STAGE2_IOS_EXIT=0
if [[ "$SKIP_STAGE2" -eq 0 ]]; then
  record "==> Stage 2: desktop creates Anthropic gift, iOS redeems + auto-fires a real Anthropic call"
  # Fresh config: no local keys on iOS this round (gift provides the route);
  # fireAfterSetup triggers the in-app helper once the gift shows up.
  write_config "$(cat <<JSON
{
  "password": "CrossDevice1234!",
  "fireAfterSetup": "anthropic",
  "fireResultOut": "$IOS_PROXY_RESULT"
}
JSON
)"
  rm -f "$DESKTOP_GIFT_LINK" "$IOS_PROXY_RESULT"

  record "Stage 2: launching Playwright (BYOKY_STAGE=2) in background"
  run_playwright 2 "$STAGE2_LOG" &
  PLAY_PID=$!

  # Wait for Playwright to mint the gift link (up to 90s — includes full
  # walletA setup + anthropic import + gift creation).
  record "Stage 2: waiting for Playwright to drop $DESKTOP_GIFT_LINK"
  for _ in $(seq 1 180); do
    [[ -s "$DESKTOP_GIFT_LINK" ]] && break
    sleep 0.5
  done
  if [[ ! -s "$DESKTOP_GIFT_LINK" ]]; then
    record "Stage 2 FAIL: Playwright never produced a gift link (see $STAGE2_LOG)"
    kill "$PLAY_PID" 2>/dev/null || true
    STAGE2_DESKTOP_EXIT=1
  else
    record "Stage 2: desktop gift link ready: $(head -c 60 "$DESKTOP_GIFT_LINK")…"
    record "Stage 2: launching XCUITest testIOSRedeemsGift_Interactive (sim: $SIM_NAME)"
    run_xcuitest "ByokyUITests/ByokyInteractiveCrossDeviceTests/testIOSRedeemsGift_Interactive" "$STAGE2_IOS_LOG"
    STAGE2_IOS_EXIT=$?
    if [[ $STAGE2_IOS_EXIT -ne 0 ]]; then
      record "Stage 2 FAIL: XCUITest exit=$STAGE2_IOS_EXIT (see $STAGE2_IOS_LOG)"
    fi
    wait "$PLAY_PID"
    STAGE2_DESKTOP_EXIT=$?
    if [[ $STAGE2_DESKTOP_EXIT -ne 0 ]]; then
      record "Stage 2 FAIL: Playwright exit=$STAGE2_DESKTOP_EXIT (see $STAGE2_LOG)"
    else
      record "Stage 2 OK: Playwright asserted iOS proxy result + desktop sent-gift usage"
    fi
  fi
else
  record "==> Stage 2: skipped (--skip-stage2)"
fi

rm -f "$CONFIG_FILE" "$IOS_GIFT_LINK" "$DESKTOP_GIFT_LINK" "$IOS_DONE_SIGNAL"

# ─────────────────────────────────────────────────────────────────────
# Recap
# ─────────────────────────────────────────────────────────────────────

echo
echo "═══════════════════════════════════════════════════════════════"
echo " Cross-device run — step-by-step recap"
echo "═══════════════════════════════════════════════════════════════"
cat "$EVENT_LOG"
rm -f "$EVENT_LOG"
echo "═══════════════════════════════════════════════════════════════"
echo " Logs:"
[[ -f "$STAGE1_IOS_LOG" ]] && echo "   Stage 1 iOS:     $STAGE1_IOS_LOG"
[[ -f "$STAGE1_LOG" ]] && echo "   Stage 1 desktop: $STAGE1_LOG"
[[ -f "$STAGE2_IOS_LOG" ]] && echo "   Stage 2 iOS:     $STAGE2_IOS_LOG"
[[ -f "$STAGE2_LOG" ]] && echo "   Stage 2 desktop: $STAGE2_LOG"
if [[ -f "$IOS_PROXY_RESULT" ]]; then
  echo "   iOS proxy result JSON:"
  sed 's/^/     /' "$IOS_PROXY_RESULT"
fi
echo "═══════════════════════════════════════════════════════════════"

if [[ $STAGE1_DESKTOP_EXIT -eq 0 && $STAGE1_IOS_EXIT -eq 0 && $STAGE2_DESKTOP_EXIT -eq 0 && $STAGE2_IOS_EXIT -eq 0 ]]; then
  exit 0
fi
exit 1
