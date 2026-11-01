#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- Load secrets ---
for envfile in .env .env.local; do
  if [ -f "$envfile" ]; then
    set -a
    source "$envfile"
    set +a
  fi
done

# Hand-written notes in docs/release-notes/v<version>.txt, when present,
# replace the store "What's New" generated from conventional-commit prefixes.
write_store_notes() {
  local version="$1" prev_tag="$2" out="$3"
  if [ -f "docs/release-notes/v${version}.txt" ]; then
    cp "docs/release-notes/v${version}.txt" "$out"
  elif [ -n "$prev_tag" ]; then
    node scripts/release-notes.mjs --store "$prev_tag" "v${version}" > "$out"
  fi
}

# The stores' state as store-status.mjs --json reports it (set STATUS_JSON
# first): status_field <store id> <field>, e.g. status_field chrome pending.
status_field() {
  node -e '
    const [json, id, field] = process.argv.slice(1)
    const r = JSON.parse(json).results.find((x) => x.id === id)
    process.stdout.write(String(r?.[field] ?? ""))
  ' "$STATUS_JSON" "$1" "$2"
}

# What happened in each store, for the summary at the end.
STORE_RESULTS=()
store_result() { STORE_RESULTS+=("$1: $2"); }

# Uploads an .ipa (ios) or .pkg (macos) to App Store Connect.
asc_upload() {
  xcrun altool --upload-app --file "$1" --type "$2" \
    --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1
}

# Runs submit-appstore.mjs <platform> <version> [minutes to wait for the
# build], and sets ASC_CODE to its exit code and ASC_RESULT to what that
# means (codes documented in submit-appstore.mjs).
appstore_submit() {
  ASC_CODE=0
  ASC_BUILD_WAIT_MIN="${3:-${ASC_BUILD_WAIT_MIN:-40}}" \
    node scripts/submit-appstore.mjs "$2" "$1" "$STORE_NOTES_FILE" 2>&1 || ASC_CODE=$?
  case "$ASC_CODE" in
    0) ASC_RESULT="submitted for review (or already in review)" ;;
    2) ASC_RESULT="PENDING: the build is still processing; submit it with ./scripts/release.sh retry" ;;
    3) ASC_RESULT="NO BUILD in App Store Connect; ./scripts/release.sh retry uploads it again" ;;
    4) ASC_RESULT="PENDING: another version is in review; ./scripts/release.sh retry once it's through" ;;
    *) ASC_RESULT="FAILED (see the log above)" ;;
  esac
}

# ============================================================
# Status check mode
# ============================================================
if [ "${1:-}" = "status" ]; then
  # Exit 3 means a review is pending, which the output already says.
  node scripts/store-status.mjs || [ $? -eq 3 ]
  exit 0
fi

# ============================================================
# Retry mode — re-publish only stores that are behind
# ============================================================
if [ "${1:-}" = "retry" ]; then
  ALLOW_PENDING=false
  for arg in "${@:2}"; do
    case "$arg" in
      --allow-pending) ALLOW_PENDING=true ;;
      *) echo "Usage: ./scripts/release.sh retry [--allow-pending]"; exit 1 ;;
    esac
  done

  CURRENT=$(node -p "require('./package.json').version")

  # Derive native version from Android gradle
  ANDROID_GRADLE="$ROOT/packages/android/app/build.gradle.kts"
  NATIVE_VERSION=$(grep 'versionName = ' "$ANDROID_GRADLE" | head -1 | sed 's/.*"\(.*\)".*/\1/')
  VERSION_CODE=$(grep 'versionCode = ' "$ANDROID_GRADLE" | head -1 | sed 's/[^0-9]//g')

  echo "Retrying failed uploads for v${CURRENT} (native ${NATIVE_VERSION}/${VERSION_CODE})..."
  echo ""

  # Generate store notes if not cached
  BUILD_DIR="$ROOT/build"
  mkdir -p "$BUILD_DIR"
  STORE_NOTES_FILE="$BUILD_DIR/store-notes.txt"
  PREV_TAG=$(git tag --list 'v*' --sort=-version:refname | sed -n '2p')
  write_store_notes "$CURRENT" "$PREV_TAG" "$STORE_NOTES_FILE"

  # Where each store stands, from the same check the release runs. A store
  # with a submission in review is left alone: an upload would replace the
  # submission and restart its review (--allow-pending uploads anyway).
  STATUS_JSON=$(node scripts/store-status.mjs --json) || [ $? -eq 3 ] \
    || { echo "Error: couldn't check the stores (scripts/store-status.mjs)"; exit 1; }
  skip_pending() {
    [ "$(status_field "$1" pending)" = true ] && [ "$ALLOW_PENDING" = false ]
  }
  pending_note() {
    echo "v$(status_field "$1" pendingVersion) is $(status_field "$1" pendingState); skipped, an upload would restart that review"
  }

  RETRIED=0

  # Chrome Web Store: the store zip, without the manifest key (see step 3)
  if [ -n "${CHROME_EXTENSION_ID:-}" ] && [ -n "${CHROME_CLIENT_ID:-}" ]; then
    CHROME_STORE_ZIP="dist/byoky-chrome-v${CURRENT}-store.zip"
    CHROME_LIVE=$(status_field chrome version)
    if [ "$CHROME_LIVE" = "$CURRENT" ]; then
      echo "Chrome: v${CHROME_LIVE} — up to date"
    elif skip_pending chrome; then
      echo "Chrome: $(pending_note chrome)"
      store_result "Chrome Web Store" "$(pending_note chrome)"
    elif [ ! -f "$CHROME_STORE_ZIP" ]; then
      echo "Chrome: ${CHROME_STORE_ZIP} is missing"
      store_result "Chrome Web Store" "FAILED: ${CHROME_STORE_ZIP} is missing"
    else
      echo "Chrome: v${CHROME_LIVE} → v${CURRENT}"
      if npx chrome-webstore-upload upload \
        --source "$CHROME_STORE_ZIP" \
        --extension-id "$CHROME_EXTENSION_ID" \
        --client-id "$CHROME_CLIENT_ID" \
        --client-secret "$CHROME_CLIENT_SECRET" \
        --refresh-token "$CHROME_REFRESH_TOKEN" \
        --auto-publish 2>&1; then
        RETRIED=$((RETRIED + 1))
        store_result "Chrome Web Store" "uploaded, publishes after review"
      else
        echo "  WARN: Chrome upload failed"
        store_result "Chrome Web Store" "FAILED (see the log above)"
      fi
    fi
  fi

  # Firefox AMO
  if [ -n "${AMO_API_KEY:-}" ] && [ -n "${AMO_API_SECRET:-}" ]; then
    # The newest listed version, also when it still awaits review.
    AMO_LIVE=$(status_field firefox version)
    if [ "$AMO_LIVE" = "$CURRENT" ]; then
      echo "Firefox: v${AMO_LIVE} $(status_field firefox status) — uploaded"
    elif skip_pending firefox; then
      echo "Firefox: $(pending_note firefox)"
      store_result "Firefox Add-ons" "$(pending_note firefox)"
    elif [ -d "packages/extension/.output/firefox-mv2" ]; then
      echo "Firefox: v${AMO_LIVE} → v${CURRENT}"
      if npx web-ext sign \
        --source-dir packages/extension/.output/firefox-mv2 \
        --api-key "$AMO_API_KEY" \
        --api-secret "$AMO_API_SECRET" \
        --channel listed \
        --upload-source-code "dist/byoky-source-v${CURRENT}.zip" 2>&1; then
        RETRIED=$((RETRIED + 1))
        store_result "Firefox Add-ons" "submitted for review"
      else
        echo "  WARN: Firefox upload failed"
        store_result "Firefox Add-ons" "FAILED (see the log above)"
      fi
    fi
  fi

  # App Store (iOS + macOS): a quick look first; a build App Store Connect
  # never got is uploaded again, and one still processing is waited for.
  if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
    for platform in IOS MAC_OS; do
      if [ "$platform" = IOS ]; then
        label="App Store (iOS)"; file="dist/byoky-ios-v${CURRENT}.ipa"; type=ios
      else
        label="App Store (macOS)"; file="dist/byoky-macos-v${CURRENT}.pkg"; type=macos
      fi
      echo "${label}: checking..."
      appstore_submit "$platform" "$NATIVE_VERSION" 0
      if [ "$ASC_CODE" -eq 3 ] && [ ! -f "$file" ]; then
        ASC_RESULT="NO BUILD in App Store Connect, and no ${file} to upload"
      elif [ "$ASC_CODE" -eq 3 ]; then
        echo "${label}: uploading ${file} again..."
        if asc_upload "$file" "$type"; then
          appstore_submit "$platform" "$NATIVE_VERSION"
        else
          ASC_CODE=1; ASC_RESULT="upload FAILED (see the log above)"
        fi
      elif [ "$ASC_CODE" -eq 2 ]; then
        appstore_submit "$platform" "$NATIVE_VERSION"
      fi
      echo "${label}: ${ASC_RESULT}"
      store_result "$label" "$ASC_RESULT"
      if [ "$ASC_CODE" -eq 0 ]; then RETRIED=$((RETRIED + 1)); fi
    done
  fi

  # Google Play
  if [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ] && [ -f "dist/byoky-android-v${CURRENT}.aab" ]; then
    GP_LIVE=$(node -e "
      fetch('https://play.google.com/store/apps/details?id=com.byoky.app&hl=en',{headers:{'User-Agent':'Mozilla/5.0'}})
        .then(r=>r.text()).then(h=>{const m=h.match(/\[\[\[\"(\d+\.\d+\.\d+)\"\]\]/)||h.match(/Current Version.*?>([\d.]+)</);console.log(m?.[1]||'unknown')})
    " 2>/dev/null)
    if [ "$GP_LIVE" != "$NATIVE_VERSION" ]; then
      echo "Google Play: v${GP_LIVE} → v${NATIVE_VERSION}"
      if node scripts/upload-google-play.mjs "dist/byoky-android-v${CURRENT}.aab" production "$STORE_NOTES_FILE" 2>&1; then
        RETRIED=$((RETRIED + 1))
        store_result "Google Play" "uploaded to the production track"
      else
        echo "  WARN: Google Play upload failed"
        store_result "Google Play" "FAILED (see the log above)"
      fi
    else
      echo "Google Play: v${GP_LIVE} — up to date"
    fi
  fi

  # Discord (skip on retry — already posted)

  echo ""
  for r in ${STORE_RESULTS[@]+"${STORE_RESULTS[@]}"}; do echo "  $r"; done
  if [ "$RETRIED" -eq 0 ]; then
    echo "Nothing retried."
  else
    echo "Retried $RETRIED store(s). Run 'pnpm release:status' to verify."
    node scripts/generate-versions.mjs 2>&1 || true
  fi
  # A failure above leaves its store behind; say so in the exit code too.
  for r in ${STORE_RESULTS[@]+"${STORE_RESULTS[@]}"}; do
    case "$r" in *FAILED*|*"NO BUILD"*) exit 1 ;; esac
  done
  exit 0
fi

# --- Parse args ---
DRY_RUN=false
SKIP_MOBILE=false
SKIP_STORE_UPLOADS=false
ASSUME_YES=false
ALLOW_PENDING=false
ALLOW_BRANCH=false
ALLOW_DIRTY=false
NEW_VERSION=""

for arg in "$@"; do
  case "$arg" in
    --dry)     DRY_RUN=true ;;
    --skip-mobile) SKIP_MOBILE=true ;;
    --skip-store-uploads) SKIP_STORE_UPLOADS=true ;;
    --yes)     ASSUME_YES=true ;;
    --allow-pending) ALLOW_PENDING=true ;;
    --allow-branch) ALLOW_BRANCH=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    *)         NEW_VERSION="$arg" ;;
  esac
done

if [ -z "$NEW_VERSION" ]; then
  CURRENT=$(node -p "require('./package.json').version")
  echo "Usage: ./scripts/release.sh <new-version> [--dry] [--skip-mobile] [--skip-store-uploads] [--yes]"
  echo "                                           [--allow-pending] [--allow-branch] [--allow-dirty]"
  echo "       ./scripts/release.sh status"
  echo "       ./scripts/release.sh retry [--allow-pending]"
  echo ""
  echo "  --dry                  Run the checks and print the plan; changes nothing"
  echo "                         (signing is only checked, nothing is bumped or published)"
  echo "  --skip-mobile          Skip iOS/macOS/Android builds and uploads"
  echo "  --skip-store-uploads   Build + npm publish + GitHub release, but skip"
  echo "                         Chrome/Firefox/App Store/Play uploads"
  echo "  --yes                  Don't ask before starting (non-interactive runs)"
  echo "  --allow-pending        Release although a store has a review pending"
  echo "                         (an upload restarts that review; --yes doesn't imply it)"
  echo "  --allow-branch         Release from a branch other than main (e.g. a worktree);"
  echo "                         HEAD must contain origin/main, and the release commit is"
  echo "                         pushed to main all the same"
  echo "  --allow-dirty          Release with uncommitted or untracked files: they are"
  echo "                         built and shipped but NOT committed or tagged"
  echo ""
  echo "Releases go out from main: fast-forward main to the work, release from the main"
  echo "checkout. The release commit and tag v<version> are pushed to origin main."
  echo ""
  echo "Current version: $CURRENT"
  exit 1
fi

# Validate semver format
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be semver (e.g. 0.5.2)"
  exit 1
fi

OLD_VERSION=$(node -p "require('./package.json').version")

# ============================================================
# Pre-flight checks
# ============================================================
echo "╔══════════════════════════════════════════════════════╗"
echo "║              byoky release pipeline                 ║"
echo "║              $OLD_VERSION → $NEW_VERSION                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

echo "==> Pre-flight checks..."

ERRORS=()
WARNINGS=()

# Required tools
for cmd in node pnpm gh git zip; do
  if ! command -v "$cmd" &>/dev/null; then
    ERRORS+=("Missing required tool: $cmd")
  fi
done

if [ "$SKIP_MOBILE" = false ]; then
  if ! command -v xcodebuild &>/dev/null; then
    WARNINGS+=("xcodebuild not found — iOS/macOS builds will be skipped")
    SKIP_IOS=true
  else
    SKIP_IOS=false
  fi

  ANDROID_GRADLE="$ROOT/packages/android/app/build.gradle.kts"
  if [ ! -f "$ROOT/packages/android/gradlew" ]; then
    WARNINGS+=("Android gradlew not found — Android build will be skipped")
    SKIP_ANDROID=true
  else
    SKIP_ANDROID=false
  fi
else
  SKIP_IOS=true
  SKIP_ANDROID=true
fi

# Check git state. Everything is built from the working tree, but only the
# version files are committed: an uncommitted or untracked change would ship
# in the npm packages and store builds without being in the tag.
DIRTY=$(git status --porcelain --untracked-files=normal)
if [ -n "$DIRTY" ] && [ "$ALLOW_DIRTY" = true ]; then
  WARNINGS+=("Uncommitted changes (--allow-dirty): they are BUILT AND SHIPPED but NOT committed or tagged")
elif [ -n "$DIRTY" ]; then
  ERRORS+=("Uncommitted or untracked files would ship without being in the release commit or tag. Commit or stash them, or pass --allow-dirty:"$'\n'"$(echo "$DIRTY" | sed 's/^/           /')")
fi

# The release commit and tag go to main, on top of what origin has. A release
# from another branch left main without the bump, and the next release from
# main reused that build number, which the stores refuse.
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ] && [ "$ALLOW_BRANCH" = true ]; then
  WARNINGS+=("On '${CURRENT_BRANCH:-a detached HEAD}', not main (--allow-branch): the release commit is pushed to main")
elif [ "$CURRENT_BRANCH" != "main" ]; then
  ERRORS+=("On '${CURRENT_BRANCH:-a detached HEAD}', not main. Fast-forward main to it and release from the main checkout, or pass --allow-branch (the release commit then goes to main)")
fi

if ! git fetch --quiet origin main --tags; then
  ERRORS+=("Couldn't fetch main and the tags from origin")
elif ! git merge-base --is-ancestor origin/main HEAD; then
  ERRORS+=("HEAD doesn't contain origin/main: merge or rebase onto it first")
fi

if git rev-parse -q --verify "refs/tags/v${NEW_VERSION}" >/dev/null || \
   [ -n "$(git ls-remote --tags origin "refs/tags/v${NEW_VERSION}" 2>/dev/null)" ]; then
  ERRORS+=("Tag v${NEW_VERSION} already exists. If a run of v${NEW_VERSION} stopped after tagging, push what origin lacks (git push --atomic origin HEAD:main v${NEW_VERSION}), then finish with ./scripts/release.sh retry")
fi

LATEST_TAG=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -1)
if [ -n "$LATEST_TAG" ] && [ "${LATEST_TAG#v}" != "$OLD_VERSION" ] && \
   [ "$(printf '%s\n%s\n' "${LATEST_TAG#v}" "$OLD_VERSION" | sort -V | tail -1)" = "${LATEST_TAG#v}" ]; then
  ERRORS+=("${LATEST_TAG} is newer than this tree's ${OLD_VERSION}: HEAD is missing that release's version bump")
fi

# Signing is prepared before anything is bumped, so a missing certificate or
# profile stops the release while the tree is still clean. See ios-signing.sh.
# A dry run only checks: preparing can create certificates and replace the
# team's App Store profiles. Nothing is prepared while another check failed.
SIGNING_KEYCHAIN="$HOME/Library/Keychains/byoky-signing.keychain-db"
if [ ${#ERRORS[@]} -gt 0 ]; then
  :
elif [ "$SKIP_IOS" = false ] && [ "$DRY_RUN" = true ]; then
  echo "  Checking iOS/macOS signing (read-only)..."
  if ! bash scripts/ios-signing.sh --check; then
    WARNINGS+=("iOS/macOS signing isn't ready (see above); a real run prepares it or stops here")
  fi
elif [ "$SKIP_IOS" = false ]; then
  echo "  Preparing iOS/macOS signing..."
  if ! bash scripts/ios-signing.sh; then
    ERRORS+=("iOS/macOS signing isn't ready (see above); fix it or pass --skip-mobile")
  fi
fi

# Store credentials check
STORES_CONFIGURED=()
STORES_SKIPPED=()

[ -n "${CHROME_EXTENSION_ID:-}" ] && [ -n "${CHROME_CLIENT_ID:-}" ] \
  && STORES_CONFIGURED+=("Chrome Web Store") \
  || STORES_SKIPPED+=("Chrome Web Store (CHROME_EXTENSION_ID, CHROME_CLIENT_ID)")

[ -n "${AMO_API_KEY:-}" ] && [ -n "${AMO_API_SECRET:-}" ] \
  && STORES_CONFIGURED+=("Firefox AMO") \
  || STORES_SKIPPED+=("Firefox AMO (AMO_API_KEY, AMO_API_SECRET)")

[ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -n "${ASC_PRIVATE_KEY:-}" ] \
  && STORES_CONFIGURED+=("App Store Connect") \
  || STORES_SKIPPED+=("App Store Connect (ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY)")

[ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ] \
  && STORES_CONFIGURED+=("Google Play") \
  || STORES_SKIPPED+=("Google Play (GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)")

# No store credentials at all usually means .env / .env.local didn't load
# (e.g. a worktree): the release would publish to npm and upload nothing.
if [ ${#STORES_CONFIGURED[@]} -eq 0 ] && [ "$SKIP_STORE_UPLOADS" = false ]; then
  ERRORS+=("No store credentials (.env / .env.local); pass --skip-store-uploads for an npm + GitHub-only release")
fi

[ -n "${DISCORD_WEBHOOK_URL:-}" ] \
  && STORES_CONFIGURED+=("Discord") \
  || STORES_SKIPPED+=("Discord (DISCORD_WEBHOOK_URL)")

# Report
if [ ${#ERRORS[@]} -gt 0 ]; then
  for e in "${ERRORS[@]}"; do echo "  ERROR: $e"; done
  exit 1
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
  for w in "${WARNINGS[@]}"; do echo "  WARN: $w"; done
fi

echo ""
echo "  Stores configured: ${STORES_CONFIGURED[*]:-none}"
if [ ${#STORES_SKIPPED[@]} -gt 0 ]; then echo "  Stores skipped:    ${STORES_SKIPPED[*]}"; fi
echo ""

# --- Derive native versions ---
ANDROID_GRADLE="$ROOT/packages/android/app/build.gradle.kts"
OLD_VERSION_CODE=$(grep 'versionCode = ' "$ANDROID_GRADLE" | head -1 | sed 's/[^0-9]//g')
# Build numbers must keep rising in every store, also past a release whose
# bump never reached this tree.
TAG_VERSION_CODE=""
if [ -n "$LATEST_TAG" ]; then
  TAG_VERSION_CODE=$(git show "${LATEST_TAG}:packages/android/app/build.gradle.kts" 2>/dev/null \
    | grep 'versionCode = ' | head -1 | sed 's/[^0-9]//g' || true)
fi
BASE_VERSION_CODE=$OLD_VERSION_CODE
if [ -n "$TAG_VERSION_CODE" ] && [ "$TAG_VERSION_CODE" -gt "$BASE_VERSION_CODE" ]; then
  BASE_VERSION_CODE=$TAG_VERSION_CODE
fi
NEW_VERSION_CODE=$((BASE_VERSION_CODE + 1))

OLD_NATIVE_VERSION=$(grep 'versionName = ' "$ANDROID_GRADLE" | head -1 | sed 's/.*"\(.*\)".*/\1/')
# One version for everything (since 1.1.0). The stores only accept a higher
# native version than the last one shipped.
NEW_NATIVE_VERSION="$NEW_VERSION"
if [ "$NEW_NATIVE_VERSION" = "$OLD_NATIVE_VERSION" ] || \
   [ "$(printf '%s\n%s\n' "$OLD_NATIVE_VERSION" "$NEW_NATIVE_VERSION" | sort -V | tail -1)" != "$NEW_NATIVE_VERSION" ]; then
  echo "Error: $NEW_VERSION must be higher than the native apps' current $OLD_NATIVE_VERSION"
  exit 1
fi

# --- Check store statuses ---
# Before anything is bumped: an upload to a store with a submission still in
# review replaces that submission and restarts its review.
echo "==> Checking store statuses..."
STATUS_CODE=0
node scripts/store-status.mjs || STATUS_CODE=$?
echo ""
if [ "$STATUS_CODE" -eq 3 ] && [ "$ALLOW_PENDING" = true ]; then
  echo "  WARN: a review is pending (above); --allow-pending releases anyway."
  echo ""
elif [ "$STATUS_CODE" -eq 3 ]; then
  echo "Error: a review is pending (above). Wait until it's through, or pass --allow-pending."
  exit 1
elif [ "$STATUS_CODE" -ne 0 ]; then
  echo "Error: couldn't check the stores (scripts/store-status.mjs exit $STATUS_CODE)."
  exit 1
fi

# --- Summary ---
echo "┌──────────────────────────────────────────────────────┐"
echo "│  Release plan                                        │"
echo "├──────────────────────────────────────────────────────┤"
echo "│  npm / extension:  $OLD_VERSION → $NEW_VERSION"
echo "│  Native (iOS/Android):  $OLD_NATIVE_VERSION → $NEW_NATIVE_VERSION  (code $OLD_VERSION_CODE → $NEW_VERSION_CODE)"
echo "│"
echo "│  Steps:"
echo "│    1. Bump versions across all packages"
echo "│    2. Build everything (packages, extensions, mobile)"
echo "│    3. Create dist artifacts"
echo "│    4. Git commit + tag v${NEW_VERSION}, push both to origin main"
echo "│    5. Publish npm packages"
echo "│    6. Upload to extension stores"
[ "$SKIP_IOS" = false ] && echo "│    7. Archive + upload iOS & macOS to App Store"
[ "$SKIP_ANDROID" = false ] && echo "│    8. Upload Android AAB to Google Play"
echo "│    9. Create GitHub release with release notes"
echo "└──────────────────────────────────────────────────────┘"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN — exiting. Nothing was bumped, committed, published or uploaded; signing was only checked."
  exit 0
fi

if [ "$ASSUME_YES" = false ]; then
  read -rp "Proceed? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

STEP=0
step() {
  STEP=$((STEP + 1))
  echo ""
  echo "━━━ Step $STEP: $1 ━━━"
}

# ============================================================
# 1. Bump versions
# ============================================================
step "Bump versions"

echo "  Bumping package.json files..."
PACKAGE_JSONS=(
  package.json
  packages/core/package.json
  packages/sdk/package.json
  packages/extension/package.json
  packages/bridge/package.json
  packages/web/package.json
  packages/openclaw-plugin/package.json
  packages/create-byoky-app/package.json
)

# Match whatever top-level version each package has: they can drift (e.g. an
# extension-only bump), and an unbumped package makes pnpm publish fail.
for f in "${PACKAGE_JSONS[@]}"; do
  sed -i '' -E "s/^  \"version\": \"[^\"]+\"/  \"version\": \"$NEW_VERSION\"/" "$f"
done

echo "  Bumping Android version..."
sed -i '' "s/versionCode = $OLD_VERSION_CODE/versionCode = $NEW_VERSION_CODE/" "$ANDROID_GRADLE"
sed -i '' "s/versionName = \"$OLD_NATIVE_VERSION\"/versionName = \"$NEW_NATIVE_VERSION\"/" "$ANDROID_GRADLE"

echo "  Bumping iOS versions..."
IOS_PLISTS=(
  packages/ios/Byoky/App/Info.plist
  packages/ios/SafariExtension/Info.plist
  packages/ios/macOS/Info.plist
  packages/ios/macOS/SafariExtension-macOS-Info.plist
)

# The build number follows Android's versionCode. Set it outright: the iOS
# plists drifted from versionCode once, and a sed on the old value then
# silently matched nothing (App Store Connect requires macOS build numbers
# to keep rising).
for f in "${IOS_PLISTS[@]}"; do
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $NEW_NATIVE_VERSION" "$f"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEW_VERSION_CODE" "$f"
done

echo "  Done."

# ============================================================
# 2. Build
# ============================================================
step "Build all packages"

echo "  Building npm packages..."
pnpm build

echo "  Syncing mobile bundle..."
bash scripts/sync-mobile-bundle.sh

echo "  Building Firefox extension..."
(cd packages/extension && npx wxt build --browser firefox)

echo "  Building Safari extension..."
(cd packages/extension && npx wxt build --browser safari)

# The iOS/macOS Safari extension bundles this build (SafariExtension/Resources
# is gitignored), so refresh it before archiving or the apps ship a stale copy.
echo "  Syncing Safari extension into the iOS project..."
bash packages/ios/Scripts/copy-wxt-output.sh

# --- Android ---
if [ "$SKIP_ANDROID" = false ]; then
  echo "  Building Android AAB..."
  (cd packages/android && ./gradlew bundleRelease)
fi

# --- iOS ---
IOS_DIR="$ROOT/packages/ios"
BUILD_DIR="$ROOT/build"
mkdir -p "$BUILD_DIR"

if [ "$SKIP_IOS" = false ]; then
  # Archives sign with the development identity in the signing keychain; the
  # App Store Connect key lets xcodebuild refresh development profiles without
  # an Xcode account. Exports sign manually with the App Store profiles that
  # ios-signing.sh installed and write the .ipa/.pkg locally; step 9 uploads them.
  ASC_AUTH=(
    -allowProvisioningUpdates
    -authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  )

  echo "  Archiving iOS app..."
  xcodebuild archive \
    -project "$IOS_DIR/Byoky.xcodeproj" \
    -scheme "Byoky" \
    -configuration Release \
    -archivePath "$BUILD_DIR/Byoky-iOS.xcarchive" \
    -destination "generic/platform=iOS" \
    CODE_SIGN_STYLE=Automatic \
    OTHER_CODE_SIGN_FLAGS="--keychain $SIGNING_KEYCHAIN" \
    "${ASC_AUTH[@]}" \
    -quiet

  echo "  Exporting iOS IPA..."
  rm -rf "$BUILD_DIR/ios-export"
  xcodebuild -exportArchive \
    -archivePath "$BUILD_DIR/Byoky-iOS.xcarchive" \
    -exportOptionsPlist "$IOS_DIR/ExportOptions.plist" \
    -exportPath "$BUILD_DIR/ios-export" \
    -quiet

  echo "  Archiving macOS app..."
  xcodebuild archive \
    -project "$IOS_DIR/Byoky.xcodeproj" \
    -scheme "Byoky (macOS)" \
    -configuration Release \
    -archivePath "$BUILD_DIR/Byoky-macOS.xcarchive" \
    -destination "generic/platform=macOS" \
    CODE_SIGN_STYLE=Automatic \
    OTHER_CODE_SIGN_FLAGS="--keychain $SIGNING_KEYCHAIN" \
    "${ASC_AUTH[@]}" \
    -quiet

  echo "  Exporting macOS app..."
  rm -rf "$BUILD_DIR/macos-export"
  xcodebuild -exportArchive \
    -archivePath "$BUILD_DIR/Byoky-macOS.xcarchive" \
    -exportOptionsPlist "$IOS_DIR/ExportOptions-macOS.plist" \
    -exportPath "$BUILD_DIR/macos-export" \
    -quiet
fi

# ============================================================
# 3. Create dist artifacts
# ============================================================
step "Create dist artifacts"

mkdir -p dist

(cd packages/extension/.output/chrome-mv3 && zip -r "$ROOT/dist/byoky-chrome-v${NEW_VERSION}.zip" .)
(cd packages/extension/.output/firefox-mv2 && zip -r "$ROOT/dist/byoky-firefox-v${NEW_VERSION}.zip" .)
(cd packages/extension/.output/safari-mv2 && zip -r "$ROOT/dist/byoky-safari-v${NEW_VERSION}.zip" .)

# Chrome Web Store-ready zip: same build but with the `key` field stripped
# from the manifest. CWS rejects uploads whose manifest key doesn't match the
# registered extension's key (which CWS derives from the extension ID, not
# from a user-supplied key field). The keyed zip above stays for sideloaders
# who want a stable extension ID across dev machines. Retry uploads the same
# file.
CHROME_STORE_ZIP="dist/byoky-chrome-v${NEW_VERSION}-store.zip"
STORE_DIR="$(mktemp -d)/chrome-mv3-store"
mkdir -p "$STORE_DIR"
cp -R packages/extension/.output/chrome-mv3/. "$STORE_DIR/"
node -e "const f='$STORE_DIR/manifest.json',j=JSON.parse(require('fs').readFileSync(f));delete j.key;require('fs').writeFileSync(f,JSON.stringify(j))"
(cd "$STORE_DIR" && zip -r "$ROOT/$CHROME_STORE_ZIP" .)
rm -rf "$STORE_DIR"

if [ "$SKIP_ANDROID" = false ]; then
  cp packages/android/app/build/outputs/bundle/release/app-release.aab \
     "dist/byoky-android-v${NEW_VERSION}.aab"
fi

if [ "$SKIP_IOS" = false ]; then
  # Copy IPA if export produced one
  IPA_FILE=$(find "$BUILD_DIR/ios-export" -name "*.ipa" 2>/dev/null | head -1)
  if [ -n "$IPA_FILE" ]; then
    cp "$IPA_FILE" "dist/byoky-ios-v${NEW_VERSION}.ipa"
  fi

  # Copy macOS app/pkg
  MACOS_PKG=$(find "$BUILD_DIR/macos-export" -name "*.pkg" -o -name "*.app" 2>/dev/null | head -1)
  if [ -n "$MACOS_PKG" ]; then
    if [[ "$MACOS_PKG" == *.app ]]; then
      # Zip the .app bundle for distribution
      (cd "$(dirname "$MACOS_PKG")" && zip -r "$ROOT/dist/byoky-macos-v${NEW_VERSION}.zip" "$(basename "$MACOS_PKG")")
    else
      cp "$MACOS_PKG" "dist/byoky-macos-v${NEW_VERSION}.pkg"
    fi
  fi
fi

zip -r "dist/byoky-source-v${NEW_VERSION}.zip" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml README.md \
  packages/core packages/sdk packages/extension \
  -x "*/node_modules/*" "*/dist/*" "*/.output/*"

echo "  Artifacts:"
ls -lh dist/byoky-*-v${NEW_VERSION}.* 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}'

# ============================================================
# 4. Git commit + tag
# ============================================================
step "Git commit + tag"

# Stage all version-bumped files.
git add \
  package.json \
  packages/core/package.json \
  packages/sdk/package.json \
  packages/extension/package.json \
  packages/bridge/package.json \
  packages/web/package.json \
  packages/openclaw-plugin/package.json \
  packages/create-byoky-app/package.json \
  packages/android/app/build.gradle.kts \
  packages/ios/Byoky/App/Info.plist \
  packages/ios/SafariExtension/Info.plist \
  packages/ios/macOS/Info.plist \
  packages/ios/macOS/SafariExtension-macOS-Info.plist

# Also stage the synced mobile bundles if they changed
git add packages/ios/Byoky/Resources/mobile.js 2>/dev/null || true
git add packages/android/app/src/main/assets/mobile.js 2>/dev/null || true

# The tree was clean before the bump, so anything still unstaged was changed
# by the build. It's derived from the tagged sources, but say so.
LEFT_OVER=$(git status --porcelain --untracked-files=normal | grep -v '^[MADRC] ' || true)
if [ -n "$LEFT_OVER" ] && [ "$ALLOW_DIRTY" = false ]; then
  echo "  WARN: the build changed files that the release commit leaves out:"
  echo "$LEFT_OVER" | sed 's/^/    /'
fi

git commit -m "Bump to v${NEW_VERSION} (native ${NEW_NATIVE_VERSION}/${NEW_VERSION_CODE})"
git tag "v${NEW_VERSION}"

echo "  Committed and tagged v${NEW_VERSION}"

# Push commit + tag to main, together or not at all. HEAD contains
# origin/main (pre-flight), so this is a fast-forward from any branch.
echo "  Pushing to origin main..."
git push --atomic origin HEAD:main "refs/tags/v${NEW_VERSION}"

# ============================================================
# 5. Generate release notes
# ============================================================
step "Generate release notes"

PREV_TAG=$(git tag --list 'v*' --sort=-version:refname | sed -n '2p')
if [ -z "$PREV_TAG" ]; then
  PREV_TAG=$(git rev-list --max-parents=0 HEAD | head -1)
fi

RELEASE_NOTES=$(node scripts/release-notes.mjs "$PREV_TAG" "v${NEW_VERSION}" "$NEW_VERSION" "$NEW_NATIVE_VERSION" "$NEW_VERSION_CODE")
if [ -f "docs/release-notes/v${NEW_VERSION}.txt" ]; then
  RELEASE_NOTES="$(cat "docs/release-notes/v${NEW_VERSION}.txt")"$'\n\n'"$RELEASE_NOTES"
fi
echo "$RELEASE_NOTES"

# Store-formatted notes (plain text, max 500 chars) for App Store + Google Play
STORE_NOTES_FILE="$BUILD_DIR/store-notes.txt"
write_store_notes "$NEW_VERSION" "$PREV_TAG" "$STORE_NOTES_FILE"
echo ""
echo "  Store notes:"
cat "$STORE_NOTES_FILE" | sed 's/^/    /'

# ============================================================
# 6. Publish to npm
# ============================================================
step "Publish to npm"

NPM_PACKAGES=(
  packages/core
  packages/sdk
  packages/bridge
  packages/openclaw-plugin
  packages/create-byoky-app
)

for pkg in "${NPM_PACKAGES[@]}"; do
  echo "  Publishing $(basename "$pkg")..."
  (cd "$pkg" && pnpm publish --access public --no-git-checks)
done

# ============================================================
# 7. Chrome Web Store
# ============================================================
step "Upload to extension stores"

if [ "$SKIP_STORE_UPLOADS" = true ]; then
  echo "  Skipping Chrome Web Store (--skip-store-uploads)"
  store_result "Chrome Web Store" "skipped (--skip-store-uploads)"
elif [ -n "${CHROME_EXTENSION_ID:-}" ] && [ -n "${CHROME_CLIENT_ID:-}" ]; then
  echo "  Uploading to Chrome Web Store..."
  if npx chrome-webstore-upload upload \
    --source "$CHROME_STORE_ZIP" \
    --extension-id "$CHROME_EXTENSION_ID" \
    --client-id "$CHROME_CLIENT_ID" \
    --client-secret "$CHROME_CLIENT_SECRET" \
    --refresh-token "$CHROME_REFRESH_TOKEN" \
    --auto-publish; then
    store_result "Chrome Web Store" "uploaded, publishes after review"
  else
    echo "  WARN: Chrome upload failed; the other stores still go out (retry with ./scripts/release.sh retry)"
    store_result "Chrome Web Store" "FAILED; ./scripts/release.sh retry uploads it again"
  fi
else
  echo "  Skipping Chrome Web Store (credentials not configured)"
  store_result "Chrome Web Store" "skipped (credentials not configured)"
fi

# ============================================================
# 8. Firefox Add-ons (AMO)
# ============================================================
if [ "$SKIP_STORE_UPLOADS" = true ]; then
  echo "  Skipping Firefox Add-ons (--skip-store-uploads)"
  store_result "Firefox Add-ons" "skipped (--skip-store-uploads)"
elif [ -n "${AMO_API_KEY:-}" ] && [ -n "${AMO_API_SECRET:-}" ]; then
  echo "  Uploading to Firefox Add-ons..."
  if npx web-ext sign \
    --source-dir packages/extension/.output/firefox-mv2 \
    --api-key "$AMO_API_KEY" \
    --api-secret "$AMO_API_SECRET" \
    --channel listed \
    --upload-source-code "dist/byoky-source-v${NEW_VERSION}.zip"; then
    store_result "Firefox Add-ons" "submitted for review"
  else
    echo "  WARN: Firefox upload failed; the other stores still go out (retry with ./scripts/release.sh retry)"
    store_result "Firefox Add-ons" "FAILED; ./scripts/release.sh retry uploads it again"
  fi
else
  echo "  Skipping Firefox Add-ons (credentials not configured)"
  store_result "Firefox Add-ons" "skipped (credentials not configured)"
fi

# ============================================================
# 9. App Store (iOS + macOS)
# ============================================================
step "Upload to App Store"

if [ "$SKIP_STORE_UPLOADS" = true ]; then
  echo "  Skipping App Store (--skip-store-uploads)"
  store_result "App Store (iOS + macOS)" "skipped (--skip-store-uploads)"
elif [ "$SKIP_IOS" = false ] && [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  # Upload each build, then submit it. submit-appstore.mjs waits for the
  # build to process (minutes) and says whether it got submitted.
  for platform in IOS MAC_OS; do
    if [ "$platform" = IOS ]; then
      label="App Store (iOS)"; file="dist/byoky-ios-v${NEW_VERSION}.ipa"; type=ios
    else
      label="App Store (macOS)"; file="dist/byoky-macos-v${NEW_VERSION}.pkg"; type=macos
    fi
    if [ ! -f "$file" ]; then
      echo "  Skipping ${label}: the export produced no ${file}"
      store_result "$label" "FAILED: no ${file} to upload"
      continue
    fi
    echo "  Uploading ${label}..."
    if ! asc_upload "$file" "$type"; then
      echo "  WARN: ${label} upload failed; the other stores still go out (retry with ./scripts/release.sh retry)"
      store_result "$label" "upload FAILED; ./scripts/release.sh retry uploads it again"
      continue
    fi
    echo "  Submitting ${label} for review..."
    appstore_submit "$platform" "$NEW_NATIVE_VERSION"
    store_result "$label" "$ASC_RESULT"
  done
else
  if [ "$SKIP_IOS" = true ]; then reason="iOS/macOS builds skipped"; else reason="credentials not configured"; fi
  echo "  Skipping App Store uploads (${reason})"
  store_result "App Store (iOS + macOS)" "skipped (${reason})"
fi

# ============================================================
# 10. Google Play
# ============================================================
step "Upload to Google Play"

if [ "$SKIP_STORE_UPLOADS" = true ]; then
  echo "  Skipping Google Play (--skip-store-uploads)"
  store_result "Google Play" "skipped (--skip-store-uploads)"
elif [ "$SKIP_ANDROID" = false ] && [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ]; then
  if node scripts/upload-google-play.mjs "dist/byoky-android-v${NEW_VERSION}.aab" production "$STORE_NOTES_FILE"; then
    store_result "Google Play" "uploaded to the production track"
  else
    echo "  WARN: Google Play upload failed; the GitHub release still goes out (retry with ./scripts/release.sh retry)"
    store_result "Google Play" "FAILED; ./scripts/release.sh retry uploads it again"
  fi
else
  if [ "$SKIP_ANDROID" = true ]; then reason="Android build skipped"; else reason="credentials not configured"; fi
  echo "  Skipping Google Play (${reason})"
  store_result "Google Play" "skipped (${reason})"
fi

# ============================================================
# 11. GitHub release
# ============================================================
step "Create GitHub release"

# Collect all dist artifacts for this version
RELEASE_ASSETS=()
for f in dist/byoky-*-v${NEW_VERSION}.*; do
  [ -f "$f" ] && RELEASE_ASSETS+=("$f")
done

gh release create "v${NEW_VERSION}" \
  "${RELEASE_ASSETS[@]}" \
  --title "v${NEW_VERSION}" \
  --notes "$RELEASE_NOTES"

# ============================================================
# 12. Discord notification
# ============================================================
step "Discord notification"

if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
  # Build a concise Discord message (markdown supported)
  DISCORD_MSG="**byoky v${NEW_VERSION}** released

**npm:** \`${NEW_VERSION}\` | **Native:** \`${NEW_NATIVE_VERSION}\` (${NEW_VERSION_CODE})

$(echo "$RELEASE_NOTES" | sed -n '/^### Features/,/^### [^F]/{ /^### [^F]/!p; }' | head -15)

**Links:**
- [GitHub Release](https://github.com/MichaelLod/byoky/releases/tag/v${NEW_VERSION})
- [npm](https://www.npmjs.com/package/@byoky/sdk/v/${NEW_VERSION})"

  # Discord webhook expects JSON with "content" field (max 2000 chars)
  DISCORD_PAYLOAD=$(node -e "
    const msg = process.argv[1].slice(0, 2000);
    console.log(JSON.stringify({ content: msg }));
  " "$DISCORD_MSG")

  DISCORD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -d "$DISCORD_PAYLOAD" \
    "$DISCORD_WEBHOOK_URL")

  if [ "$DISCORD_STATUS" = "204" ] || [ "$DISCORD_STATUS" = "200" ]; then
    echo "  Posted to Discord"
  else
    echo "  WARN: Discord webhook returned HTTP $DISCORD_STATUS"
  fi
else
  echo "  Skipping Discord (DISCORD_WEBHOOK_URL not configured)"
fi

# ============================================================
# 13. Update versions.json for landing page
# ============================================================
step "Update landing page versions"

node scripts/generate-versions.mjs 2>&1 || echo "  WARN: Failed to generate versions.json"

# ============================================================
# Summary
# ============================================================
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                 Release complete                     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Version:   v${NEW_VERSION}"
echo "  Native:    ${NEW_NATIVE_VERSION} (${NEW_VERSION_CODE})"
echo "  Git:       $(git rev-parse --short HEAD), pushed to main"
echo "  Tag:       v${NEW_VERSION}"
echo ""
echo "  npm:"
for pkg in "${NPM_PACKAGES[@]}"; do
  echo "    @byoky/$(basename "$pkg")@${NEW_VERSION}"
done
echo "    create-byoky-app@${NEW_VERSION}"
echo ""
echo "  Stores:"
for r in ${STORE_RESULTS[@]+"${STORE_RESULTS[@]}"}; do echo "    $r"; done
if [ "$SKIP_STORE_UPLOADS" = true ]; then
  echo "    Upload artifacts from dist/ manually when ready."
fi
[ -n "${DISCORD_WEBHOOK_URL:-}" ] && echo "    Discord: release announcement posted"
echo ""
echo "  GitHub: https://github.com/MichaelLod/byoky/releases/tag/v${NEW_VERSION}"
echo ""
echo "  Artifacts:"
for f in "${RELEASE_ASSETS[@]}"; do
  SIZE=$(ls -lh "$f" | awk '{print $5}')
  echo "    $(basename "$f") ($SIZE)"
done
