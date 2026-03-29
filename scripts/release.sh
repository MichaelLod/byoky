#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [major|minor|patch] [options]

Full release orchestrator for Byoky. Bumps version, builds, and publishes
to all configured targets.

${BOLD}Arguments:${RESET}
  major|minor|patch    Semver bump level (default: patch)

${BOLD}Options:${RESET}
  --targets LIST       Comma-separated targets (default: all)
                       Available: npm,chrome,firefox,safari,ios,android,github
  --skip-tests         Skip running tests before release
  --draft              Create GitHub release as draft
  --dry-run            Pass --dry-run to all sub-scripts
  -h, --help           Show this help

${BOLD}Examples:${RESET}
  $(basename "$0") patch                          # Full release
  $(basename "$0") minor --targets npm,github     # npm + GitHub only
  $(basename "$0") patch --dry-run                # Preview full release
EOF
  exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
BUMP_LEVEL="patch"
TARGETS=""
SKIP_TESTS=false
DRAFT=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    major|minor|patch) BUMP_LEVEL="$1"; shift ;;
    --targets)         TARGETS="$2"; shift 2 ;;
    --skip-tests)      SKIP_TESTS=true; shift ;;
    --draft)           DRAFT=true; shift ;;
    --dry-run)         DRY_RUN=true; shift ;;
    -h|--help)         usage ;;
    *)                 die "Unknown argument: $1" ;;
  esac
done

# ── Target resolution ────────────────────────────────────────────────────────
ALL_TARGETS="npm,chrome,firefox,safari,ios,android,github"
TARGETS="${TARGETS:-$ALL_TARGETS}"

has_target() {
  [[ ",$TARGETS," == *",$1,"* ]]
}

# Validate targets
IFS=',' read -ra TARGET_LIST <<< "$TARGETS"
for t in "${TARGET_LIST[@]}"; do
  case "$t" in
    npm|chrome|firefox|safari|ios|android|github) ;;
    *) die "Unknown target: $t" ;;
  esac
done

# ── Dry-run flag passthrough ─────────────────────────────────────────────────
DRY_FLAG=""
if $DRY_RUN; then
  DRY_FLAG="--dry-run"
fi

# ── Banner ───────────────────────────────────────────────────────────────────
CURRENT_VERSION="$(get_version)"
NEXT_VERSION="$(next_semver "$CURRENT_VERSION" "$BUMP_LEVEL")"

printf "\n${BOLD}╔══════════════════════════════════════════╗${RESET}\n"
printf "${BOLD}║       Byoky Release Orchestrator         ║${RESET}\n"
printf "${BOLD}╚══════════════════════════════════════════╝${RESET}\n\n"

printf "  Version:  ${YELLOW}%s${RESET} → ${GREEN}%s${RESET}\n" "$CURRENT_VERSION" "$NEXT_VERSION"
printf "  Targets:  ${BOLD}%s${RESET}\n" "$TARGETS"
if $DRY_RUN; then
  printf "  Mode:     ${YELLOW}dry run${RESET}\n"
fi
if $DRAFT; then
  printf "  GitHub:   ${YELLOW}draft${RESET}\n"
fi
echo ""

# ── Step tracking ────────────────────────────────────────────────────────────
STEP=0
TOTAL=0

# Count steps
$SKIP_TESTS || (( TOTAL++ )) || true  # tests
(( TOTAL++ )) || true                  # bump
(( TOTAL++ )) || true                  # build
has_target npm     && { (( TOTAL++ )) || true; }
has_target chrome  && { (( TOTAL++ )) || true; }
has_target firefox && { (( TOTAL++ )) || true; }
has_target safari  && { (( TOTAL++ )) || true; }
has_target ios     && { (( TOTAL++ )) || true; }
has_target android && { (( TOTAL++ )) || true; }
has_target github  && { (( TOTAL++ )) || true; }
(( TOTAL++ )) || true                  # push

step() {
  (( STEP++ )) || true
  printf "\n${BOLD}[%d/%d] %s${RESET}\n\n" "$STEP" "$TOTAL" "$1"
}

# ── Pre-flight checks ───────────────────────────────────────────────────────
info "Running pre-flight checks…"

require_cmd pnpm
require_cmd git
require_cmd jq

if ! $DRY_RUN; then
  require_clean_worktree
fi

# Check credentials for selected targets
if has_target chrome && [[ ! -f "$HOME/.byoky-secrets/chrome.env" ]]; then
  die "Chrome credentials missing: ~/.byoky-secrets/chrome.env"
fi
if has_target firefox && [[ ! -f "$HOME/.byoky-secrets/firefox.env" ]]; then
  die "Firefox credentials missing: ~/.byoky-secrets/firefox.env"
fi
if (has_target safari || has_target ios) && [[ ! -f "$HOME/.byoky-secrets/apple.env" ]]; then
  die "Apple credentials missing: ~/.byoky-secrets/apple.env"
fi
if has_target android && [[ ! -f "$HOME/.byoky-secrets/google-play.json" ]]; then
  die "Google Play credentials missing: ~/.byoky-secrets/google-play.json"
fi
if has_target github; then
  require_cmd gh
fi

info "Pre-flight checks passed."

# ── Step 1: Tests ────────────────────────────────────────────────────────────
if ! $SKIP_TESTS; then
  step "Running tests"
  if $DRY_RUN; then
    info "Would run: pnpm test"
  else
    (cd "$REPO_ROOT" && pnpm test)
  fi
fi

# ── Step 2: Bump version ────────────────────────────────────────────────────
step "Bumping version"
BUMP_ARGS=("$BUMP_LEVEL")
if $DRY_RUN; then
  BUMP_ARGS+=("--dry-run")
fi
"$SCRIPT_DIR/bump-version.sh" "${BUMP_ARGS[@]}"

# Re-read version after bump
if ! $DRY_RUN; then
  VERSION="$(get_version)"
else
  VERSION="$NEXT_VERSION"
fi

# ── Step 3: Build ────────────────────────────────────────────────────────────
step "Building all packages"
BUILD_ARGS=("--skip-install")
if $SKIP_TESTS; then
  BUILD_ARGS+=("--skip-tests")
fi
if $DRY_RUN; then
  info "Would run: build-all.sh ${BUILD_ARGS[*]}"
else
  "$SCRIPT_DIR/build-all.sh" "${BUILD_ARGS[@]}"
fi

# ── Step 4: Publish npm ─────────────────────────────────────────────────────
if has_target npm; then
  step "Publishing npm packages"
  "$SCRIPT_DIR/publish-npm.sh" $DRY_FLAG
fi

# ── Step 5: Chrome ───────────────────────────────────────────────────────────
if has_target chrome; then
  step "Uploading Chrome extension"
  "$SCRIPT_DIR/release-chrome.sh" $DRY_FLAG
fi

# ── Step 6: Firefox ──────────────────────────────────────────────────────────
if has_target firefox; then
  step "Submitting Firefox extension"
  "$SCRIPT_DIR/release-firefox.sh" $DRY_FLAG
fi

# ── Step 7: Safari ───────────────────────────────────────────────────────────
if has_target safari; then
  step "Building + uploading Safari extension"
  "$SCRIPT_DIR/release-safari.sh" $DRY_FLAG
fi

# ── Step 8: iOS ──────────────────────────────────────────────────────────────
if has_target ios; then
  step "Building + uploading iOS app"
  "$SCRIPT_DIR/release-ios.sh" $DRY_FLAG
fi

# ── Step 9: Android ──────────────────────────────────────────────────────────
if has_target android; then
  step "Building + uploading Android app"
  "$SCRIPT_DIR/release-android.sh" $DRY_FLAG
fi

# ── Step 10: GitHub release ──────────────────────────────────────────────────
if has_target github; then
  step "Creating GitHub release"
  GH_ARGS=()
  if $DRAFT; then
    GH_ARGS+=("--draft")
  fi
  if $DRY_RUN; then
    info "Would create GitHub release v$VERSION"
  else
    "$SCRIPT_DIR/release-github.sh" "$VERSION" "${GH_ARGS[@]}"
  fi
fi

# ── Step 11: Push ────────────────────────────────────────────────────────────
step "Pushing commits and tags"
if $DRY_RUN; then
  info "Would run: git push && git push --tags"
else
  git push
  git push --tags
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
printf "${GREEN}╔══════════════════════════════════════════╗${RESET}\n"
printf "${GREEN}║          Release v%-22s ║${RESET}\n" "$VERSION"
printf "${GREEN}╚══════════════════════════════════════════╝${RESET}\n"
echo ""
