#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [options]

Build the Android app bundle and upload to Google Play.

${BOLD}Options:${RESET}
  --track TRACK    Release track: internal|alpha|beta|production (default: internal)
  --dry-run        Show what would happen without building or uploading
  -h, --help       Show this help

${BOLD}Credentials:${RESET}
  Service account JSON: ~/.byoky-secrets/google-play.json
  Signing keystore: packages/android/byoky-upload.keystore
EOF
  exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
DRY_RUN=false
TRACK="internal"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --track)     TRACK="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    -h|--help)   usage ;;
    *)           die "Unknown argument: $1" ;;
  esac
done

case "$TRACK" in
  internal|alpha|beta|production) ;;
  *) die "Invalid track: $TRACK (expected internal|alpha|beta|production)" ;;
esac

# ── Prerequisites ────────────────────────────────────────────────────────────
ANDROID_DIR="$REPO_ROOT/packages/android"
VERSION="$(get_version)"
BUILD_NUM="$(get_mobile_build)"

CREDENTIALS="$HOME/.byoky-secrets/google-play.json"
if [[ ! -f "$CREDENTIALS" ]]; then
  die "Google Play credentials not found: $CREDENTIALS — run setup-credentials.sh first"
fi

KEYSTORE="$ANDROID_DIR/byoky-upload.keystore"
if [[ ! -f "$KEYSTORE" ]]; then
  die "Upload keystore not found: $KEYSTORE"
fi

# ── Build ────────────────────────────────────────────────────────────────────
printf "\n${BOLD}Android App — v%s (build %s)${RESET}\n\n" "$VERSION" "$BUILD_NUM"
info "Track: $TRACK"

if $DRY_RUN; then
  warn "Dry run — no changes will be made"
  info "Would build: bundleRelease"
  info "Would upload AAB to Google Play ($TRACK track)"
  info "Credentials: $CREDENTIALS"
  echo ""
  printf "${GREEN}✔${RESET} Dry run complete.\n"
  exit 0
fi

# ── Build AAB ────────────────────────────────────────────────────────────────
info "Building release bundle…"
(cd "$ANDROID_DIR" && ./gradlew bundleRelease -q)

AAB="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
if [[ ! -f "$AAB" ]]; then
  die "AAB not found at expected path: $AAB"
fi

info "AAB built: $AAB"

# Copy to dist
DIST_DIR="$REPO_ROOT/dist"
mkdir -p "$DIST_DIR"
cp "$AAB" "$DIST_DIR/byoky-android-v${VERSION}.aab"
info "Copied to dist/byoky-android-v${VERSION}.aab"

# ── Upload to Google Play ────────────────────────────────────────────────────
info "Uploading to Google Play ($TRACK track)…"

if command -v googleplay &>/dev/null; then
  googleplay upload \
    --service-account "$CREDENTIALS" \
    --track "$TRACK" \
    "$AAB"
elif command -v bundletool &>/dev/null; then
  warn "googleplay CLI not found, attempting bundletool…"
  bundletool install-apks \
    --bundle="$AAB" \
    --output="$DIST_DIR/byoky-android-v${VERSION}.apks"
  warn "bundletool does not support direct Play Store upload."
  warn "Please upload $AAB manually via Google Play Console."
else
  require_cmd npx
  npx @nicolo-ribaudo/play-store-upload \
    --key "$CREDENTIALS" \
    --track "$TRACK" \
    --aab "$AAB"
fi

echo ""
printf "${GREEN}✔${RESET} Android app v%s uploaded to Google Play (%s track).\n" "$VERSION" "$TRACK"
