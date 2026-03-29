#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [options]

Upload and publish the Chrome extension to the Chrome Web Store.

${BOLD}Options:${RESET}
  --trusted-testers    Publish to trusted testers only (staged rollout)
  --dry-run            Show what would happen without uploading
  -h, --help           Show this help

${BOLD}Credentials:${RESET}
  Loaded from ~/.byoky-secrets/chrome.env:
    CHROME_EXTENSION_ID, CHROME_CLIENT_ID,
    CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN
EOF
  exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
DRY_RUN=false
TRUSTED_TESTERS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --trusted-testers) TRUSTED_TESTERS=true; shift ;;
    --dry-run)         DRY_RUN=true; shift ;;
    -h|--help)         usage ;;
    *)                 die "Unknown argument: $1" ;;
  esac
done

# ── Prerequisites ────────────────────────────────────────────────────────────
require_cmd npx

VERSION="$(get_version)"
DIST_DIR="$REPO_ROOT/dist"
ZIP="$DIST_DIR/byoky-chrome-v${VERSION}.zip"

if [[ ! -f "$ZIP" ]]; then
  die "Chrome zip not found: $ZIP — run build-all.sh first"
fi

# ── Load credentials ─────────────────────────────────────────────────────────
SECRETS_FILE="$HOME/.byoky-secrets/chrome.env"
if [[ ! -f "$SECRETS_FILE" ]]; then
  die "Credentials not found: $SECRETS_FILE — run setup-credentials.sh first"
fi
source "$SECRETS_FILE"

for var in CHROME_EXTENSION_ID CHROME_CLIENT_ID CHROME_CLIENT_SECRET CHROME_REFRESH_TOKEN; do
  if [[ -z "${!var:-}" ]]; then
    die "Missing $var in $SECRETS_FILE"
  fi
done

# ── Upload ───────────────────────────────────────────────────────────────────
printf "\n${BOLD}Chrome Web Store — v%s${RESET}\n\n" "$VERSION"

if $DRY_RUN; then
  warn "Dry run — no changes will be made"
  info "Would upload: $(basename "$ZIP")"
  info "Extension ID: $CHROME_EXTENSION_ID"
  if $TRUSTED_TESTERS; then
    info "Would publish to: trusted testers"
  else
    info "Would publish to: public"
  fi
  echo ""
  printf "${GREEN}✔${RESET} Dry run complete.\n"
  exit 0
fi

info "Uploading $(basename "$ZIP")…"
npx chrome-webstore-upload-cli upload \
  --source "$ZIP" \
  --extension-id "$CHROME_EXTENSION_ID" \
  --client-id "$CHROME_CLIENT_ID" \
  --client-secret "$CHROME_CLIENT_SECRET" \
  --refresh-token "$CHROME_REFRESH_TOKEN"

echo ""

# ── Publish ──────────────────────────────────────────────────────────────────
PUBLISH_ARGS=(
  npx chrome-webstore-upload-cli publish
  --extension-id "$CHROME_EXTENSION_ID"
  --client-id "$CHROME_CLIENT_ID"
  --client-secret "$CHROME_CLIENT_SECRET"
  --refresh-token "$CHROME_REFRESH_TOKEN"
)

if $TRUSTED_TESTERS; then
  info "Publishing to trusted testers…"
  PUBLISH_ARGS+=(--trusted-testers)
else
  info "Publishing to public…"
fi

"${PUBLISH_ARGS[@]}"

echo ""
printf "${GREEN}✔${RESET} Chrome extension v%s published.\n" "$VERSION"
