#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/version.sh"

# ── Usage ────────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
${BOLD}Usage:${RESET} $(basename "$0") [version] [options]

Create a GitHub release with changelog and extension artifacts.

${BOLD}Arguments:${RESET}
  version       Version to release (default: read from root package.json)

${BOLD}Options:${RESET}
  --draft       Create as draft release
  -h, --help    Show this help
EOF
  exit 0
}

# ── Parse args ───────────────────────────────────────────────────────────────
VERSION=""
DRAFT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --draft)     DRAFT=true; shift ;;
    -h|--help)   usage ;;
    -*)          die "Unknown option: $1" ;;
    *)           VERSION="$1"; shift ;;
  esac
done

# ── Prerequisites ────────────────────────────────────────────────────────────
require_cmd gh
require_cmd git

VERSION="${VERSION:-$(get_version)}"
TAG="v$VERSION"

printf "\n${BOLD}Creating GitHub release %s${RESET}\n\n" "$TAG"

# Verify tag exists
if ! git rev-parse "$TAG" &>/dev/null; then
  die "Tag $TAG does not exist. Run bump-version.sh first."
fi

# ── Generate changelog ───────────────────────────────────────────────────────
info "Generating changelog…"

# Find previous tag
PREV_TAG="$(git tag --sort=-v:refname | grep -E '^v[0-9]' | sed -n '2p' || true)"

if [[ -z "$PREV_TAG" ]]; then
  RANGE="$TAG"
  info "  No previous tag found — using all commits up to $TAG"
else
  RANGE="${PREV_TAG}..${TAG}"
  info "  Changelog range: $PREV_TAG → $TAG"
fi

# Collect commits grouped by type
FEATURES=""
FIXES=""
OTHER=""

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  if [[ "$line" =~ ^feat ]]; then
    # Strip "feat: " or "feat(scope): " prefix for cleaner display
    msg="$(echo "$line" | sed 's/^feat\([^)]*\)\?: //')"
    FEATURES+="- $msg"$'\n'
  elif [[ "$line" =~ ^fix ]]; then
    msg="$(echo "$line" | sed 's/^fix\([^)]*\)\?: //')"
    FIXES+="- $msg"$'\n'
  else
    OTHER+="- $line"$'\n'
  fi
done < <(git log "$RANGE" --pretty=format:'%s' --no-merges 2>/dev/null)

CHANGELOG=""
if [[ -n "$FEATURES" ]]; then
  CHANGELOG+="### Features"$'\n'"$FEATURES"$'\n'
fi
if [[ -n "$FIXES" ]]; then
  CHANGELOG+="### Fixes"$'\n'"$FIXES"$'\n'
fi
if [[ -n "$OTHER" ]]; then
  CHANGELOG+="### Other"$'\n'"$OTHER"$'\n'
fi

if [[ -z "$CHANGELOG" ]]; then
  CHANGELOG="No notable changes."
fi

echo ""
printf "${BOLD}Changelog:${RESET}\n"
echo "$CHANGELOG"

# ── Create release ───────────────────────────────────────────────────────────
DRAFT_FLAG=""
if $DRAFT; then
  DRAFT_FLAG="--draft"
  info "Creating as draft release"
fi

DIST_DIR="$REPO_ROOT/dist"
ASSETS=()
if [[ -d "$DIST_DIR" ]]; then
  while IFS= read -r f; do
    ASSETS+=("$f")
  done < <(find "$DIST_DIR" -name '*.zip' -type f | sort)
fi

info "Creating release $TAG…"
GH_ARGS=(
  gh release create "$TAG"
  --title "$TAG"
  --notes "$CHANGELOG"
)

if $DRAFT; then
  GH_ARGS+=(--draft)
fi

for asset in "${ASSETS[@]}"; do
  GH_ARGS+=("$asset")
done

"${GH_ARGS[@]}"

echo ""
printf "${GREEN}✔${RESET} Release ${BOLD}%s${RESET} created.\n" "$TAG"

if [[ ${#ASSETS[@]} -gt 0 ]]; then
  info "Uploaded ${#ASSETS[@]} artifact(s):"
  for asset in "${ASSETS[@]}"; do
    printf "    %s\n" "$(basename "$asset")"
  done
fi
echo ""
