#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [options]

Build and upload the Safari extension (macOS app wrapper) to App Store Connect.

${BOLD}Options:${RESET}
  --dry-run    Show what would happen without building or uploading
  -h, --help   Show this help

${BOLD}Credentials:${RESET}
  Loaded from ~/.byoky-secrets/apple.env:
    APPLE_ID, APP_SPECIFIC_PASSWORD
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
require_cmd xcodebuild
require_cmd xcrun

TEAM_ID="9X22GVKZ85"
PROJECT_DIR="$REPO_ROOT/packages/ios"
PROJECT="$PROJECT_DIR/Byoky.xcodeproj"
BUILD_DIR="$REPO_ROOT/build"
ARCHIVE_PATH="$BUILD_DIR/ByokySafari.xcarchive"
EXPORT_PATH="$BUILD_DIR/safari-export"
VERSION="$(get_version)"

# ── Load credentials ─────────────────────────────────────────────────────────
SECRETS_FILE="$HOME/.byoky-secrets/apple.env"
if [[ ! -f "$SECRETS_FILE" ]]; then
  die "Credentials not found: $SECRETS_FILE — run setup-credentials.sh first"
fi
source "$SECRETS_FILE"

for var in APPLE_ID APP_SPECIFIC_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    die "Missing $var in $SECRETS_FILE"
  fi
done

# ── Build ────────────────────────────────────────────────────────────────────
printf "\n${BOLD}Safari Extension (macOS) — v%s${RESET}\n\n" "$VERSION"

if $DRY_RUN; then
  warn "Dry run — no changes will be made"
  info "Would archive: Byoky (macOS) scheme"
  info "Would export to: $EXPORT_PATH"
  info "Would upload via xcrun altool"
  info "Team ID: $TEAM_ID"
  echo ""
  printf "${GREEN}✔${RESET} Dry run complete.\n"
  exit 0
fi

mkdir -p "$BUILD_DIR"

# ── Archive ──────────────────────────────────────────────────────────────────
info "Archiving Safari extension…"
xcodebuild \
  -project "$PROJECT" \
  -scheme "Byoky (macOS)" \
  -configuration Release \
  -destination "generic/platform=macOS" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  archive \
  -archivePath "$ARCHIVE_PATH" \
  -quiet

info "Archive created: $ARCHIVE_PATH"

# ── Export ───────────────────────────────────────────────────────────────────
info "Exporting archive…"

EXPORT_PLIST="$BUILD_DIR/safari-export-options.plist"
cat > "$EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>${TEAM_ID}</string>
    <key>destination</key>
    <string>upload</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
PLIST

xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -exportPath "$EXPORT_PATH" \
  -quiet

info "Export complete: $EXPORT_PATH"

# ── Upload ───────────────────────────────────────────────────────────────────
info "Uploading to App Store Connect…"

xcrun altool --upload-app \
  --type macos \
  --file "$EXPORT_PATH"/*.pkg \
  --apiKey "$APPLE_ID" \
  --apiIssuer "$TEAM_ID" 2>/dev/null \
  || xcrun altool --upload-app \
    --type macos \
    --file "$EXPORT_PATH"/*.pkg \
    --username "$APPLE_ID" \
    --password "$APP_SPECIFIC_PASSWORD" \
    --team-id "$TEAM_ID"

echo ""
printf "${GREEN}✔${RESET} Safari extension v%s uploaded to App Store Connect.\n" "$VERSION"
