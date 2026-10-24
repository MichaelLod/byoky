#!/bin/bash
# Capture Android emulator screens for marketing.
#
# Drives the real UI over adb: every tap looks its target up by visible text
# or content description in a `uiautomator dump`, so nothing depends on
# screen size or tap coordinates. Walks:
#
#   onboarding → wallet → add credential → apps / add by URL → in-wallet
#   browser → connected → settings (backup)
#
# Output: marketing/raw/android/<name>.png at emulator native resolution
# (typically 1080×1920 / 1080×2400, Google Play phone-portrait spec):
#
#   01-onboarding        welcome screen
#   02-set-password      master password + confirm filled in
#   03-wallet-empty      wallet before any key
#   04-add-credential    Add API Key sheet
#   05-wallet-with-keys  wallet with every key from .env.local
#   06-apps-empty        Apps tab, nothing added yet
#   07-add-app-form      Add app by URL (byoky.com/chat)
#   08-app-runtime       the app running in the in-wallet browser
#   09-apps-grid         Apps tab with the added app
#   10-connected-apps    Connected tab (sessions + routing groups)
#   11-settings          Settings incl. encrypted .byoky backup
#
# compose.ts consumes these names; keep both sides in sync.
#
# Requires: a booted emulator/device visible via `adb devices` with the Byoky
# debug APK installed. Keys are read from .env.local (ANTHROPIC_API_KEY,
# OPENAI_API_KEY, GEMINI_API_KEY); each one is optional.
#
# --skip-setup   Don't wipe app data or onboard; reuse the wallet that's
#                already on the device (unlocks it if needed) and re-snap
#                frames 05–11 only. capture-android-simple.sh runs this.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${ROOT}/marketing/raw/android"
ENV_FILE="${ROOT}/.env.local"
PKG="com.byoky.app"
PASSWORD="MarketingDemo!2026"
APP_URL="https://byoky.com/chat"
APP_NAME="Byoky Chat"

SKIP_SETUP=0
for arg in "$@"; do
  case "${arg}" in
    --skip-setup) SKIP_SETUP=1 ;;
    *) echo "✗ unknown argument: ${arg}" >&2; exit 2 ;;
  esac
done

mkdir -p "${OUT}"
[ "${SKIP_SETUP}" -eq 0 ] && rm -f "${OUT}"/*.png

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

if [ -f "${ENV_FILE}" ]; then
  set -a; source "${ENV_FILE}"; set +a
fi

# Screen size (an "Override size" line wins over "Physical size").
SIZE="$(adb -s "${DEVICE}" shell wm size | tr -d '\r' | awk -F': ' '/size/{s=$2} END{print s}')"
W="${SIZE%x*}"
H="${SIZE#*x}"
echo "✓ Screen ${W}x${H}"

UI_XML="$(mktemp -t byoky-mkt-ui.XXXXXX)"
trap 'rm -f "${UI_XML}"' EXIT

adb_sh() { adb -s "${DEVICE}" shell "$@"; }

snap() {
  local name="$1"
  sleep 0.6
  adb -s "${DEVICE}" exec-out screencap -p > "${OUT}/${name}.png"
  echo "  📸 ${name}.png"
}

# uiautomator refuses to dump while an animation is running ("could not get
# idle state"), so retry a few times before giving up.
dump_ui() {
  local i
  for i in 1 2 3 4 5; do
    if adb_sh uiautomator dump /sdcard/byoky-mkt-ui.xml >/dev/null 2>&1 &&
      adb -s "${DEVICE}" exec-out cat /sdcard/byoky-mkt-ui.xml > "${UI_XML}" 2>/dev/null &&
      [ -s "${UI_XML}" ]; then
      return 0
    fi
    sleep 0.5
  done
  : > "${UI_XML}"
  return 1
}

# Print "x y" (centre of bounds) for a node in the last dump.
#   find_node text "Get Started" [first|last]   text or content-desc equals
#   find_node class android.widget.EditText N   Nth (1-based, or "last") node of a class
find_node() {
  MODE="$1" NEEDLE="$2" WHICH="${3:-first}" perl -0777 -ne '
    my @hits;
    while (/<node\b([^>]*)>/g) {
      my $attrs = $1;
      my ($t) = $attrs =~ /\btext="([^"]*)"/;
      my ($d) = $attrs =~ /\bcontent-desc="([^"]*)"/;
      my ($c) = $attrs =~ /\bclass="([^"]*)"/;
      my $hit = $ENV{MODE} eq "class"
        ? (defined $c && $c eq $ENV{NEEDLE})
        : ((defined $t && $t eq $ENV{NEEDLE}) || (defined $d && $d eq $ENV{NEEDLE}));
      next unless $hit;
      my ($x1, $y1, $x2, $y2) = $attrs =~ /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/ or next;
      push @hits, sprintf("%d %d", ($x1 + $x2) / 2, ($y1 + $y2) / 2);
    }
    exit 1 unless @hits;
    my $w = $ENV{WHICH};
    my $pick = $w eq "last" ? $hits[-1] : $w eq "first" ? $hits[0] : $hits[$w - 1];
    exit 1 unless defined $pick;
    print $pick;
  ' "${UI_XML}"
}

# wait_for <text> [timeout_s] — succeeds once a node with that text/desc shows.
wait_for() {
  local label="$1" timeout="${2:-10}" deadline
  deadline=$(( $(date +%s) + timeout ))
  while :; do
    dump_ui && find_node text "${label}" >/dev/null && return 0
    [ "$(date +%s)" -ge "${deadline}" ] && return 1
    sleep 0.5
  done
}

# wait_gone <text> [timeout_s] — succeeds once no node has that text/desc.
wait_gone() {
  local label="$1" timeout="${2:-10}" deadline
  deadline=$(( $(date +%s) + timeout ))
  while :; do
    if dump_ui && ! find_node text "${label}" >/dev/null; then return 0; fi
    [ "$(date +%s)" -ge "${deadline}" ] && return 1
    sleep 0.5
  done
}

# tap <text> [first|last] [timeout_s]
tap() {
  local label="$1" which="${2:-first}" timeout="${3:-10}" xy deadline
  deadline=$(( $(date +%s) + timeout ))
  while :; do
    if dump_ui && xy="$(find_node text "${label}" "${which}")"; then
      adb_sh input tap ${xy}
      sleep 0.4
      return 0
    fi
    [ "$(date +%s)" -ge "${deadline}" ] && break
    sleep 0.5
  done
  echo "  ⚠ '${label}' not found on screen" >&2
  return 1
}

# tap_field <label> <fallback-index> — Compose text fields don't always expose
# their label as text, so fall back to the Nth EditText on screen.
tap_field() {
  local label="$1" nth="$2" xy
  tap "${label}" last 3 2>/dev/null && return 0
  if dump_ui && xy="$(find_node class android.widget.EditText "${nth}")"; then
    adb_sh input tap ${xy}
    sleep 0.4
    return 0
  fi
  echo "  ⚠ text field '${label}' not found" >&2
  return 1
}

# `input text` treats %s as a space; single-quote for the device shell.
type_text() {
  local s="${1// /%s}"
  adb_sh "input text '${s}'"
  sleep 0.3
}

hide_keyboard() {
  if adb_sh dumpsys input_method 2>/dev/null | grep -Eq 'mInputShown=true|isInputViewShown=true'; then
    adb_sh input keyevent 4
    sleep 0.5
  fi
}

scroll_up() {
  adb_sh input swipe $(( W / 2 )) $(( H * 3 / 4 )) $(( W / 2 )) $(( H / 3 )) 300
  sleep 0.6
}

# add_credential <provider name in the sheet> <key>
add_credential() {
  local provider="$1" key="$2" field="API Key"
  # Empty wallet shows an "Add API Key" button; otherwise go through the FAB.
  if ! tap "Add API Key" first 2 2>/dev/null; then
    tap "Open add menu" && tap "Add credential"
  fi
  wait_for "Provider" 5 || return 1
  tap "${provider}" || return 1
  if [ "${provider}" = "Anthropic" ] && [[ "${key}" == sk-ant-oat01-* ]]; then
    tap "Setup Token" first
    field="Setup Token"
  fi
  # The label pre-fills with the provider name; only the key needs typing.
  tap_field "${field}" last && type_text "${key}"
  hide_keyboard
  scroll_up
  tap "Save" last || return 1
  wait_gone "Provider" 10
}

open_tab() {
  tap "$1" last
  sleep 1
}

# ── Launch ───────────────────────────────────────────────────────────────
if [ "${SKIP_SETUP}" -eq 0 ]; then
  adb_sh pm clear "${PKG}" >/dev/null
fi
adb_sh am start -W -n "${PKG}/.MainActivity" >/dev/null
sleep 3

if [ "${SKIP_SETUP}" -eq 0 ]; then
  # ── 1. Onboarding → master password ─────────────────────────────────────
  wait_for "Get Started" 15 || echo "  ⚠ onboarding screen not detected"
  snap "01-onboarding"
  tap "Get Started"
  wait_for "Create Wallet" 10
  tap_field "Master password" 1 && type_text "${PASSWORD}"
  tap_field "Confirm password" 2 && type_text "${PASSWORD}"
  hide_keyboard
  snap "02-set-password"
  tap "Create Wallet"

  # ── 2. Wallet + credentials ─────────────────────────────────────────────
  wait_for "No credentials yet" 30 || echo "  ⚠ empty wallet not detected"
  snap "03-wallet-empty"

  if tap "Add API Key" first 5; then
    wait_for "Provider" 5
    snap "04-add-credential"
    adb_sh input keyevent 4   # close the sheet again; add_credential reopens it
    wait_gone "Provider" 5
  fi

  added=0
  [ -n "${ANTHROPIC_API_KEY:-}" ] && add_credential "Anthropic" "${ANTHROPIC_API_KEY}" && added=$((added + 1))
  [ -n "${OPENAI_API_KEY:-}" ] && add_credential "OpenAI" "${OPENAI_API_KEY}" && added=$((added + 1))
  [ -n "${GEMINI_API_KEY:-}" ] && add_credential "Google Gemini" "${GEMINI_API_KEY}" && added=$((added + 1))
  [ "${added}" -eq 0 ] && echo "  ⚠ no credentials added (missing keys in .env.local?)"
else
  if wait_for "Unlock" 5; then
    tap_field "Master password" 1 && type_text "${PASSWORD}"
    hide_keyboard
    tap "Unlock"
    sleep 3
  fi
fi

open_tab "Wallet"
snap "05-wallet-with-keys"

# ── 3. Apps: add one by URL, open it in the in-wallet browser ────────────
open_tab "Apps"
if wait_for "No apps yet" 3; then
  snap "06-apps-empty"
fi
tap "Add app" first
if wait_for "App URL" 5; then
  tap_field "App URL" 1 && type_text "${APP_URL}"
  tap_field "Name (optional)" 2 && type_text "${APP_NAME}"
  hide_keyboard
  snap "07-add-app-form"
  tap "Add and open"
  if wait_for "Close app" 15; then
    sleep 5   # let the page load
    snap "08-app-runtime"
    tap "Close app"
    sleep 1
  else
    echo "  ⚠ in-wallet browser didn't open"
  fi
fi
open_tab "Apps"
snap "09-apps-grid"

# ── 4. Connected apps + routing groups ───────────────────────────────────
open_tab "Connected"
snap "10-connected-apps"

# ── 5. Settings (pushed from the wallet's top bar) ───────────────────────
open_tab "Wallet"
tap "Settings" first
wait_for "Backup" 5
snap "11-settings"

echo ""
echo "✓ Android frames written to ${OUT}/"
ls -1 "${OUT}/"*.png 2>/dev/null | xargs -I{} basename {} 2>/dev/null
