#!/usr/bin/env bash
set -euo pipefail

# Requires: REPO_ROOT set by common.sh, jq

# ── Read helpers ─────────────────────────────────────────────────────────────

get_version() {
  jq -r '.version' "$REPO_ROOT/package.json"
}

get_mobile_version() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" \
    "$REPO_ROOT/packages/ios/Byoky/App/Info.plist"
}

get_mobile_build() {
  sed -n 's/.*versionCode[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' \
    "$REPO_ROOT/packages/android/app/build.gradle.kts"
}

# ── Write helpers ────────────────────────────────────────────────────────────

# bump_npm_versions NEW_VERSION
#   Updates root + all 9 packages/*/package.json
bump_npm_versions() {
  local new_version="$1"
  local pkg_files=()
  pkg_files+=("$REPO_ROOT/package.json")
  while IFS= read -r f; do
    pkg_files+=("$f")
  done < <(find "$REPO_ROOT/packages" -maxdepth 2 -name package.json | sort)

  for f in "${pkg_files[@]}"; do
    local tmp
    tmp="$(jq --arg v "$new_version" '.version = $v' "$f")"
    printf '%s\n' "$tmp" > "$f"
    info "  $(basename "$(dirname "$f")")/package.json → $new_version"
  done
}

# bump_mobile_versions NEW_VERSION NEW_BUILD
#   Updates iOS plists, Android build.gradle.kts, and project.yml
bump_mobile_versions() {
  local new_version="$1"
  local new_build="$2"

  # ── iOS Info.plist files ─────────────────────────────────────────────────
  local plist_files=(
    "$REPO_ROOT/packages/ios/Byoky/App/Info.plist"
    "$REPO_ROOT/packages/ios/SafariExtension/Info.plist"
    "$REPO_ROOT/packages/ios/macOS/Info.plist"
    "$REPO_ROOT/packages/ios/macOS/SafariExtension-macOS-Info.plist"
  )

  for plist in "${plist_files[@]}"; do
    if [[ -f "$plist" ]]; then
      /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $new_version" "$plist"
      /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $new_build" "$plist"
      info "  $(echo "$plist" | sed "s|$REPO_ROOT/||") → $new_version ($new_build)"
    fi
  done

  # ── Android build.gradle.kts ─────────────────────────────────────────────
  local gradle="$REPO_ROOT/packages/android/app/build.gradle.kts"
  if [[ -f "$gradle" ]]; then
    sed -i '' "s/versionCode = [0-9]*/versionCode = $new_build/" "$gradle"
    sed -i '' "s/versionName = \"[^\"]*\"/versionName = \"$new_version\"/" "$gradle"
    info "  packages/android/app/build.gradle.kts → $new_version ($new_build)"
  fi

  # ── iOS project.yml (if MARKETING_VERSION / CURRENT_PROJECT_VERSION exist)
  local project_yml="$REPO_ROOT/packages/ios/project.yml"
  if [[ -f "$project_yml" ]]; then
    if grep -q 'MARKETING_VERSION' "$project_yml"; then
      sed -i '' "s/MARKETING_VERSION: .*/MARKETING_VERSION: \"$new_version\"/" "$project_yml"
      sed -i '' "s/CURRENT_PROJECT_VERSION: .*/CURRENT_PROJECT_VERSION: $new_build/" "$project_yml"
      info "  packages/ios/project.yml → $new_version ($new_build)"
    fi
  fi
}

# ── Semver arithmetic ────────────────────────────────────────────────────────

# next_semver CURRENT_VERSION major|minor|patch
next_semver() {
  local ver="$1" part="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$ver"
  case "$part" in
    major) echo "$(( major + 1 )).0.0" ;;
    minor) echo "$major.$(( minor + 1 )).0" ;;
    patch) echo "$major.$minor.$(( patch + 1 ))" ;;
    *) die "Invalid semver part: $part (expected major|minor|patch)" ;;
  esac
}
