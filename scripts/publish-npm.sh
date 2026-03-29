#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [options]

Publish public npm packages in dependency order.

${BOLD}Options:${RESET}
  --dry-run    Run publish with --dry-run (no actual publish)
  -h, --help   Show this help
EOF
  exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    -h|--help)   usage ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ── Prerequisites ────────────────────────────────────────────────────────────
require_cmd pnpm
require_cmd npm

info "Checking npm authentication…"
NPM_USER="$(npm whoami 2>/dev/null)" || die "Not logged in to npm. Run: npm login"
info "Authenticated as ${BOLD}$NPM_USER${RESET}"

VERSION="$(get_version)"
printf "\n${BOLD}Publishing v%s${RESET}\n\n" "$VERSION"

if $DRY_RUN; then
  warn "Dry run mode — packages will NOT be published"
  echo ""
fi

# ── Publish order (dependency-first) ─────────────────────────────────────────
# Package dir name → npm name
PACKAGES=(
  "core"
  "sdk"
  "bridge"
  "openclaw-plugin"
  "relay"
  "create-byoky-app"
)

DRY_FLAG=""
if $DRY_RUN; then
  DRY_FLAG="--dry-run"
fi

PUBLISHED=()
FAILED=()

for pkg in "${PACKAGES[@]}"; do
  pkg_dir="$REPO_ROOT/packages/$pkg"
  pkg_name="$(jq -r '.name' "$pkg_dir/package.json")"

  printf "${BLUE}▸${RESET} Publishing ${BOLD}%s${RESET}…" "$pkg_name"

  if (cd "$pkg_dir" && pnpm publish --access public --no-git-checks $DRY_FLAG 2>&1); then
    printf " ${GREEN}✔${RESET}\n"
    PUBLISHED+=("$pkg_name")
  else
    printf " ${RED}✖${RESET}\n"
    FAILED+=("$pkg_name")
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
printf "${BOLD}Publish summary:${RESET}\n"
if [[ ${#PUBLISHED[@]} -gt 0 ]]; then
  for p in "${PUBLISHED[@]}"; do
    printf "  ${GREEN}✔${RESET} %s\n" "$p"
  done
fi
if [[ ${#FAILED[@]} -gt 0 ]]; then
  for p in "${FAILED[@]}"; do
    printf "  ${RED}✖${RESET} %s\n" "$p"
  done
  echo ""
  die "Some packages failed to publish."
fi

echo ""
printf "${GREEN}✔${RESET} All packages published successfully.\n"
