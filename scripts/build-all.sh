#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [options]

Build all packages and create extension zips.

${BOLD}Options:${RESET}
  --skip-install    Skip pnpm install
  --skip-tests      Skip typecheck
  -h, --help        Show this help
EOF
  exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
SKIP_INSTALL=false
SKIP_TESTS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install) SKIP_INSTALL=true; shift ;;
    --skip-tests)   SKIP_TESTS=true; shift ;;
    -h|--help)      usage ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ── Prerequisites ────────────────────────────────────────────────────────────
require_cmd pnpm
require_cmd zip

VERSION="$(get_version)"
DIST_DIR="$REPO_ROOT/dist"
EXT_DIR="$REPO_ROOT/packages/extension"

printf "\n${BOLD}Building byoky v%s${RESET}\n\n" "$VERSION"

# ── Step 1: Install ─────────────────────────────────────────────────────────
if ! $SKIP_INSTALL; then
  info "Installing dependencies…"
  (cd "$REPO_ROOT" && pnpm install --frozen-lockfile)
  echo ""
fi

# ── Step 2: Typecheck ───────────────────────────────────────────────────────
if ! $SKIP_TESTS; then
  info "Running typecheck…"
  (cd "$REPO_ROOT" && pnpm typecheck)
  echo ""
fi

# ── Step 3: Build all packages ──────────────────────────────────────────────
info "Building all packages…"
(cd "$REPO_ROOT" && pnpm build)
echo ""

# ── Step 4: Build Chrome extension ──────────────────────────────────────────
info "Building Chrome extension…"
(cd "$EXT_DIR" && pnpm build)
echo ""

# ── Step 5: Build Firefox extension ─────────────────────────────────────────
info "Building Firefox extension…"
(cd "$EXT_DIR" && pnpm build:firefox)
echo ""

# ── Step 6: Package zips ────────────────────────────────────────────────────
info "Packaging extension zips…"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Chrome
CHROME_DIR="$EXT_DIR/.output/chrome-mv3"
if [[ -d "$CHROME_DIR" ]]; then
  (cd "$CHROME_DIR" && zip -r -q "$DIST_DIR/byoky-chrome-v${VERSION}.zip" .)
  info "  ✔ dist/byoky-chrome-v${VERSION}.zip"
else
  warn "Chrome build output not found at $CHROME_DIR"
fi

# Firefox
FIREFOX_DIR="$EXT_DIR/.output/firefox-mv2"
if [[ -d "$FIREFOX_DIR" ]]; then
  (cd "$FIREFOX_DIR" && zip -r -q "$DIST_DIR/byoky-firefox-v${VERSION}.zip" .)
  info "  ✔ dist/byoky-firefox-v${VERSION}.zip"
else
  warn "Firefox build output not found at $FIREFOX_DIR"
fi

# Source zip for Firefox review
info "Creating source archive for Firefox review…"
(cd "$REPO_ROOT" && zip -r -q "$DIST_DIR/byoky-source-v${VERSION}.zip" . \
  -x 'node_modules/*' '*/node_modules/*' '.git/*' 'dist/*' \
     '.output/*' '*/.output/*' '.wxt/*' '*/.wxt/*' \
     '*.xcodeproj/*' 'DerivedData/*' \
     'packages/android/.gradle/*' 'packages/android/build/*' \
     'packages/android/app/build/*')
info "  ✔ dist/byoky-source-v${VERSION}.zip"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
printf "${GREEN}✔${RESET} ${BOLD}Build complete!${RESET}\n\n"
info "Artifacts in dist/:"
ls -lh "$DIST_DIR"/*.zip 2>/dev/null | while read -r line; do
  printf "    %s\n" "$line"
done
echo ""
