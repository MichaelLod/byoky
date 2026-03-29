#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [major|minor|patch] [options]

Bump version numbers across the monorepo.

${BOLD}Arguments:${RESET}
  major|minor|patch    Semver bump level (default: patch)

${BOLD}Options:${RESET}
  --npm-only           Only bump npm/extension versions
  --mobile-only        Only bump mobile versions
  --mobile-bump LEVEL  Semver bump level for mobile (default: same as main)
  --dry-run            Show what would change without modifying files
  -h, --help           Show this help
EOF
  exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
BUMP_LEVEL="patch"
MOBILE_BUMP=""
NPM_ONLY=false
MOBILE_ONLY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    major|minor|patch) BUMP_LEVEL="$1"; shift ;;
    --npm-only)        NPM_ONLY=true; shift ;;
    --mobile-only)     MOBILE_ONLY=true; shift ;;
    --mobile-bump)     MOBILE_BUMP="$2"; shift 2 ;;
    --dry-run)         DRY_RUN=true; shift ;;
    -h|--help)         usage ;;
    *) die "Unknown argument: $1" ;;
  esac
done

if $NPM_ONLY && $MOBILE_ONLY; then
  die "--npm-only and --mobile-only are mutually exclusive"
fi

MOBILE_BUMP="${MOBILE_BUMP:-$BUMP_LEVEL}"

# ── Prerequisites ────────────────────────────────────────────────────────────
require_cmd jq
if ! $DRY_RUN; then
  require_clean_worktree
fi

# ── Calculate versions ───────────────────────────────────────────────────────
CURRENT_NPM="$(get_version)"
NEXT_NPM="$(next_semver "$CURRENT_NPM" "$BUMP_LEVEL")"

CURRENT_MOBILE="$(get_mobile_version)"
NEXT_MOBILE="$(next_semver "$CURRENT_MOBILE" "$MOBILE_BUMP")"
CURRENT_BUILD="$(get_mobile_build)"
NEXT_BUILD="$(( CURRENT_BUILD + 1 ))"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
printf "${BOLD}Version bump plan:${RESET}\n"
if ! $MOBILE_ONLY; then
  printf "  npm/extension: ${YELLOW}%s${RESET} → ${GREEN}%s${RESET}\n" "$CURRENT_NPM" "$NEXT_NPM"
fi
if ! $NPM_ONLY; then
  printf "  mobile:        ${YELLOW}%s${RESET} → ${GREEN}%s${RESET} (build ${YELLOW}%s${RESET} → ${GREEN}%s${RESET})\n" \
    "$CURRENT_MOBILE" "$NEXT_MOBILE" "$CURRENT_BUILD" "$NEXT_BUILD"
fi

if $DRY_RUN; then
  echo ""
  info "Dry run — no files modified."
  exit 0
fi

echo ""
if ! confirm "Proceed?"; then
  die "Aborted."
fi

# ── Apply bumps ──────────────────────────────────────────────────────────────
echo ""

if ! $MOBILE_ONLY; then
  printf "${BOLD}Bumping npm versions → %s${RESET}\n" "$NEXT_NPM"
  bump_npm_versions "$NEXT_NPM"
fi

if ! $NPM_ONLY; then
  echo ""
  printf "${BOLD}Bumping mobile versions → %s (build %s)${RESET}\n" "$NEXT_MOBILE" "$NEXT_BUILD"
  bump_mobile_versions "$NEXT_MOBILE" "$NEXT_BUILD"
fi

# ── Git commit & tag ─────────────────────────────────────────────────────────
echo ""
info "Committing version bump…"
git add -A
if ! $MOBILE_ONLY && ! $NPM_ONLY; then
  git commit -m "Bump to $NEXT_NPM, mobile $NEXT_MOBILE (build $NEXT_BUILD)"
elif $MOBILE_ONLY; then
  git commit -m "Bump mobile to $NEXT_MOBILE (build $NEXT_BUILD)"
else
  git commit -m "Bump to $NEXT_NPM"
fi

if ! $MOBILE_ONLY; then
  info "Tagging v$NEXT_NPM"
  git tag "v$NEXT_NPM"
fi

echo ""
printf "${GREEN}✔${RESET} Version bump complete.\n"
