#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [options]

Submit the Firefox extension to AMO (addons.mozilla.org).

${BOLD}Options:${RESET}
  --dry-run    Show what would happen without uploading
  -h, --help   Show this help

${BOLD}Credentials:${RESET}
  Loaded from ~/.byoky-secrets/firefox.env:
    WEB_EXT_API_KEY, WEB_EXT_API_SECRET
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

# ── Prerequisites ────────────────────────────────────────────────────────────
require_cmd npx

VERSION="$(get_version)"
DIST_DIR="$REPO_ROOT/dist"
EXT_ZIP="$DIST_DIR/byoky-firefox-v${VERSION}.zip"
SRC_ZIP="$DIST_DIR/byoky-source-v${VERSION}.zip"

if [[ ! -f "$EXT_ZIP" ]]; then
  die "Firefox zip not found: $EXT_ZIP — run build-all.sh first"
fi
if [[ ! -f "$SRC_ZIP" ]]; then
  die "Source zip not found: $SRC_ZIP — run build-all.sh first"
fi

# ── Load credentials ─────────────────────────────────────────────────────────
SECRETS_FILE="$HOME/.byoky-secrets/firefox.env"
if [[ ! -f "$SECRETS_FILE" ]]; then
  die "Credentials not found: $SECRETS_FILE — run setup-credentials.sh first"
fi
source "$SECRETS_FILE"

for var in WEB_EXT_API_KEY WEB_EXT_API_SECRET; do
  if [[ -z "${!var:-}" ]]; then
    die "Missing $var in $SECRETS_FILE"
  fi
done

# ── Submit ───────────────────────────────────────────────────────────────────
printf "\n${BOLD}Firefox AMO — v%s${RESET}\n\n" "$VERSION"

if $DRY_RUN; then
  warn "Dry run — no changes will be made"
  info "Would upload: $(basename "$EXT_ZIP")"
  info "Would attach source: $(basename "$SRC_ZIP")"
  echo ""
  printf "${GREEN}✔${RESET} Dry run complete.\n"
  exit 0
fi

info "Submitting $(basename "$EXT_ZIP") to AMO…"
info "Attaching source: $(basename "$SRC_ZIP")"

npx web-ext sign \
  --source-dir "$EXT_ZIP" \
  --artifacts-dir "$DIST_DIR" \
  --upload-source-code "$SRC_ZIP" \
  --channel listed \
  --api-key "$WEB_EXT_API_KEY" \
  --api-secret "$WEB_EXT_API_SECRET" \
  --amo-metadata "$REPO_ROOT/packages/extension/amo-metadata.json" 2>/dev/null \
  || npx web-ext sign \
    --source-dir "$EXT_ZIP" \
    --artifacts-dir "$DIST_DIR" \
    --upload-source-code "$SRC_ZIP" \
    --channel listed \
    --api-key "$WEB_EXT_API_KEY" \
    --api-secret "$WEB_EXT_API_SECRET"

echo ""
printf "${GREEN}✔${RESET} Firefox extension v%s submitted to AMO.\n" "$VERSION"
