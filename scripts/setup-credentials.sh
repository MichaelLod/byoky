#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [options]

Interactive setup guide for Byoky release credentials.
Creates credential files in ~/.byoky-secrets/.

${BOLD}Options:${RESET}
  --dry-run    Show what would be configured without writing files
  -h, --help   Show this help

${BOLD}Credential sets:${RESET}
  1. Chrome Web Store   → ~/.byoky-secrets/chrome.env
  2. Firefox AMO        → ~/.byoky-secrets/firefox.env
  3. Apple (iOS/Safari) → ~/.byoky-secrets/apple.env
  4. Google Play        → ~/.byoky-secrets/google-play.json
EOF
  exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    -h|--help)   usage ;;
    *)           die "Unknown argument: $1" ;;
  esac
done

# ── Setup ────────────────────────────────────────────────────────────────────
SECRETS_DIR="$HOME/.byoky-secrets"

printf "\n${BOLD}Byoky Credential Setup${RESET}\n\n"
info "Credentials will be stored in: $SECRETS_DIR"
echo ""

if $DRY_RUN; then
  warn "Dry run — no files will be written"
  echo ""
fi

if ! $DRY_RUN; then
  mkdir -p "$SECRETS_DIR"
  chmod 700 "$SECRETS_DIR"
fi

# ── Helper: prompt for a value ───────────────────────────────────────────────
prompt_value() {
  local label="$1" var_name="$2" current="${3:-}"
  if [[ -n "$current" ]]; then
    printf "  ${BOLD}%s${RESET} [current: %s]: " "$label" "${current:0:8}…"
  else
    printf "  ${BOLD}%s${RESET}: " "$label"
  fi
  read -r value
  if [[ -z "$value" && -n "$current" ]]; then
    value="$current"
  fi
  eval "$var_name=\"\$value\""
}

# ── 1. Chrome Web Store ─────────────────────────────────────────────────────
setup_chrome() {
  printf "\n${BOLD}━━━ Chrome Web Store ━━━${RESET}\n\n"
  info "Required for uploading to the Chrome Web Store."
  echo ""
  info "To get these credentials:"
  info "  1. Go to https://console.cloud.google.com/apis/credentials"
  info "  2. Create an OAuth 2.0 Client ID (type: Desktop app)"
  info "  3. Note the Client ID and Client Secret"
  info "  4. Get a refresh token using the chrome-webstore-upload-cli:"
  info "     npx chrome-webstore-upload-cli init"
  info "  5. Find your Extension ID in chrome://extensions"
  echo ""

  local existing_file="$SECRETS_DIR/chrome.env"
  local ext_id="" client_id="" client_secret="" refresh_token=""

  if [[ -f "$existing_file" ]]; then
    source "$existing_file"
    ext_id="${CHROME_EXTENSION_ID:-}"
    client_id="${CHROME_CLIENT_ID:-}"
    client_secret="${CHROME_CLIENT_SECRET:-}"
    refresh_token="${CHROME_REFRESH_TOKEN:-}"
    info "Existing credentials found. Press Enter to keep current values."
    echo ""
  fi

  prompt_value "Extension ID" ext_id "$ext_id"
  prompt_value "Client ID" client_id "$client_id"
  prompt_value "Client Secret" client_secret "$client_secret"
  prompt_value "Refresh Token" refresh_token "$refresh_token"

  if [[ -z "$ext_id" || -z "$client_id" || -z "$client_secret" || -z "$refresh_token" ]]; then
    warn "Incomplete credentials — skipping Chrome setup"
    return
  fi

  if $DRY_RUN; then
    info "Would write: $existing_file"
    return
  fi

  cat > "$existing_file" <<EOF
CHROME_EXTENSION_ID="$ext_id"
CHROME_CLIENT_ID="$client_id"
CHROME_CLIENT_SECRET="$client_secret"
CHROME_REFRESH_TOKEN="$refresh_token"
EOF
  chmod 600 "$existing_file"
  printf "  ${GREEN}✔${RESET} Saved to %s\n" "$existing_file"

  # Test
  info "Testing credentials…"
  if npx chrome-webstore-upload-cli get --extension-id "$ext_id" \
    --client-id "$client_id" --client-secret "$client_secret" \
    --refresh-token "$refresh_token" &>/dev/null; then
    printf "  ${GREEN}✔${RESET} Chrome credentials are valid\n"
  else
    warn "Could not verify Chrome credentials (may still be valid)"
  fi
}

# ── 2. Firefox AMO ──────────────────────────────────────────────────────────
setup_firefox() {
  printf "\n${BOLD}━━━ Firefox AMO ━━━${RESET}\n\n"
  info "Required for submitting to addons.mozilla.org."
  echo ""
  info "To get these credentials:"
  info "  1. Go to https://addons.mozilla.org/developers/addon/api/key/"
  info "  2. Generate API credentials"
  info "  3. Note the JWT issuer (API key) and JWT secret (API secret)"
  echo ""

  local existing_file="$SECRETS_DIR/firefox.env"
  local api_key="" api_secret=""

  if [[ -f "$existing_file" ]]; then
    source "$existing_file"
    api_key="${WEB_EXT_API_KEY:-}"
    api_secret="${WEB_EXT_API_SECRET:-}"
    info "Existing credentials found. Press Enter to keep current values."
    echo ""
  fi

  prompt_value "API Key (JWT issuer)" api_key "$api_key"
  prompt_value "API Secret (JWT secret)" api_secret "$api_secret"

  if [[ -z "$api_key" || -z "$api_secret" ]]; then
    warn "Incomplete credentials — skipping Firefox setup"
    return
  fi

  if $DRY_RUN; then
    info "Would write: $existing_file"
    return
  fi

  cat > "$existing_file" <<EOF
WEB_EXT_API_KEY="$api_key"
WEB_EXT_API_SECRET="$api_secret"
EOF
  chmod 600 "$existing_file"
  printf "  ${GREEN}✔${RESET} Saved to %s\n" "$existing_file"
}

# ── 3. Apple (iOS + Safari) ─────────────────────────────────────────────────
setup_apple() {
  printf "\n${BOLD}━━━ Apple (iOS + Safari) ━━━${RESET}\n\n"
  info "Required for uploading to App Store Connect."
  echo ""
  info "To get these credentials:"
  info "  1. Sign in at https://appleid.apple.com/"
  info "  2. Go to Sign-In and Security → App-Specific Passwords"
  info "  3. Generate a new app-specific password for 'byoky-release'"
  info "  4. Your Apple ID is the email you sign in with"
  echo ""

  local existing_file="$SECRETS_DIR/apple.env"
  local apple_id="" app_password=""

  if [[ -f "$existing_file" ]]; then
    source "$existing_file"
    apple_id="${APPLE_ID:-}"
    app_password="${APP_SPECIFIC_PASSWORD:-}"
    info "Existing credentials found. Press Enter to keep current values."
    echo ""
  fi

  prompt_value "Apple ID (email)" apple_id "$apple_id"
  prompt_value "App-Specific Password" app_password "$app_password"

  if [[ -z "$apple_id" || -z "$app_password" ]]; then
    warn "Incomplete credentials — skipping Apple setup"
    return
  fi

  if $DRY_RUN; then
    info "Would write: $existing_file"
    return
  fi

  cat > "$existing_file" <<EOF
APPLE_ID="$apple_id"
APP_SPECIFIC_PASSWORD="$app_password"
EOF
  chmod 600 "$existing_file"
  printf "  ${GREEN}✔${RESET} Saved to %s\n" "$existing_file"

  # Test
  info "Testing credentials…"
  if xcrun altool --list-apps \
    --username "$apple_id" \
    --password "$app_password" \
    --team-id "9X22GVKZ85" &>/dev/null 2>&1; then
    printf "  ${GREEN}✔${RESET} Apple credentials are valid\n"
  else
    warn "Could not verify Apple credentials (may still be valid)"
  fi
}

# ── 4. Google Play ──────────────────────────────────────────────────────────
setup_google_play() {
  printf "\n${BOLD}━━━ Google Play ━━━${RESET}\n\n"
  info "Required for uploading to Google Play Store."
  echo ""
  info "To get a service account JSON key:"
  info "  1. Go to Google Play Console → Setup → API access"
  info "  2. Link your Google Cloud project"
  info "  3. Create a service account with 'Release manager' role"
  info "  4. In Google Cloud Console, create a JSON key for the service account"
  info "  5. Download the JSON key file"
  echo ""

  local target="$SECRETS_DIR/google-play.json"

  if [[ -f "$target" ]]; then
    info "Existing credentials found at: $target"
    if ! confirm "Replace?"; then
      return
    fi
  fi

  printf "  ${BOLD}Path to service account JSON${RESET}: "
  read -r json_path

  if [[ -z "$json_path" ]]; then
    warn "No path provided — skipping Google Play setup"
    return
  fi

  json_path="${json_path/#\~/$HOME}"
  if [[ ! -f "$json_path" ]]; then
    warn "File not found: $json_path — skipping"
    return
  fi

  # Validate JSON
  if ! jq empty "$json_path" 2>/dev/null; then
    warn "Invalid JSON file — skipping"
    return
  fi

  if $DRY_RUN; then
    info "Would copy: $json_path → $target"
    return
  fi

  cp "$json_path" "$target"
  chmod 600 "$target"
  printf "  ${GREEN}✔${RESET} Saved to %s\n" "$target"

  # Validate structure
  local email
  email="$(jq -r '.client_email // empty' "$target")"
  if [[ -n "$email" ]]; then
    printf "  ${GREEN}✔${RESET} Service account: %s\n" "$email"
  else
    warn "JSON does not contain client_email — may not be a valid service account key"
  fi
}

# ── Main flow ────────────────────────────────────────────────────────────────
printf "${BOLD}Which credentials would you like to set up?${RESET}\n\n"
printf "  1. Chrome Web Store\n"
printf "  2. Firefox AMO\n"
printf "  3. Apple (iOS + Safari)\n"
printf "  4. Google Play\n"
printf "  5. All\n"
echo ""
printf "${BOLD}Choice${RESET} [5]: "
read -r choice
choice="${choice:-5}"

case "$choice" in
  1) setup_chrome ;;
  2) setup_firefox ;;
  3) setup_apple ;;
  4) setup_google_play ;;
  5)
    setup_chrome
    setup_firefox
    setup_apple
    setup_google_play
    ;;
  *) die "Invalid choice: $choice" ;;
esac

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
printf "${BOLD}Credential status:${RESET}\n"

check_cred() {
  local label="$1" file="$2"
  if [[ -f "$file" ]]; then
    printf "  ${GREEN}✔${RESET} %-20s %s\n" "$label" "$file"
  else
    printf "  ${RED}✖${RESET} %-20s not configured\n" "$label"
  fi
}

check_cred "Chrome Web Store" "$SECRETS_DIR/chrome.env"
check_cred "Firefox AMO" "$SECRETS_DIR/firefox.env"
check_cred "Apple" "$SECRETS_DIR/apple.env"
check_cred "Google Play" "$SECRETS_DIR/google-play.json"

echo ""
printf "${GREEN}✔${RESET} Setup complete.\n"
