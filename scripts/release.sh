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

# The files a release bumps and commits (steps 1 and 4), and the synced
# mobile bundles it commits when they changed.
VERSION_FILES=(
  package.json
  packages/core/package.json
  packages/sdk/package.json
  packages/extension/package.json
  packages/bridge/package.json
  packages/web/package.json
  packages/openclaw-plugin/package.json
  packages/create-byoky-app/package.json
  packages/android/app/build.gradle.kts
  packages/ios/Byoky/App/Info.plist
  packages/ios/SafariExtension/Info.plist
  packages/ios/macOS/Info.plist
  packages/ios/macOS/SafariExtension-macOS-Info.plist
)
MOBILE_BUNDLES=(
  packages/ios/Byoky/Resources/mobile.js
  packages/android/app/src/main/assets/mobile.js
)

NPM_PACKAGES=(
  packages/core
  packages/sdk
  packages/bridge
  packages/openclaw-plugin
  packages/create-byoky-app
)

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

# How AMO's reviewers rebuild the add-on; BUILD-FIREFOX.md in the source zip.
amo_build_note() {
  cat <<'EOF'
# Building the Byoky Firefox add-on from this source

Requirements: Node.js 20 or newer and pnpm 9.15.9 (`corepack enable` picks the
version up from package.json), on macOS or Linux.

    pnpm install --frozen-lockfile
    pnpm build:core
    pnpm build:sdk
    pnpm --filter @byoky/extension build:firefox

The add-on is then in packages/extension/.output/firefox-mv2, file for file
the same as the submitted package.
EOF
}

# Unzips the AMO source zip into a temporary directory, builds the add-on
# there as BUILD-FIREFOX.md says and compares the result with the build that
# gets uploaded. AMO's reviewers must be able to do exactly that.
check_source_zip() {
  local zip="$1" dir log="$ROOT/build/source-zip-check.log" rc=0
  mkdir -p "$ROOT/build"
  dir=$(mktemp -d)
  {
    unzip -q "$zip" -d "$dir" &&
      (cd "$dir" &&
        pnpm install --frozen-lockfile --prefer-offline &&
        pnpm build:core &&
        pnpm build:sdk &&
        pnpm --filter @byoky/extension build:firefox) &&
      diff -rq "$dir/packages/extension/.output/firefox-mv2" "$ROOT/packages/extension/.output/firefox-mv2"
  } > "$log" 2>&1 || rc=$?
  rm -rf "$dir"
  if [ "$rc" -ne 0 ]; then
    echo "  The source zip doesn't rebuild the uploaded add-on (full log: $log):"
    tail -15 "$log" | sed 's/^/    /'
  fi
  return "$rc"
}

# The iOS unit tests (ByokyTests) on a booted simulator of their own, deleted
# afterwards (scripts/ios-unit-tests.sh, which CI runs too).
run_ios_tests() {
  # The Byoky scheme builds the Safari extension, which bundles the WXT build.
  (cd packages/extension && npx wxt build --browser safari) || return 1
  bash packages/ios/Scripts/copy-wxt-output.sh || return 1
  SIM_NAME="byoky-release-tests-$$" bash scripts/ios-unit-tests.sh "$ROOT/build/DerivedData-tests" --quiet
}

# Publishes the packages of NPM_PACKAGES that npm doesn't have at $1 yet,
# so a release that stopped half-way through can be finished.
npm_publish_missing() {
  local pkg name
  for pkg in "${NPM_PACKAGES[@]}"; do
    name=$(node -p "require('./${pkg}/package.json').name")
    if [ "$(npm view "${name}@$1" version 2>/dev/null || true)" = "$1" ]; then
      echo "  ${name}@$1 is already on npm"
    else
      echo "  Publishing ${name}@$1..."
      (cd "$pkg" && pnpm publish --access public --no-git-checks) || return 1
    fi
  done
}

# Creates GitHub release v$1 with the dist artifacts unless it exists.
# --verify-tag: gh would otherwise create a missing tag on main's tip.
github_release() {
  local f assets=()
  if gh release view "v$1" >/dev/null 2>&1; then
    echo "  GitHub release v$1 already exists"
    return 0
  fi
  for f in dist/byoky-*-v"$1".*; do
    [ -f "$f" ] && assets+=("$f")
  done
  gh release create "v$1" ${assets[@]+"${assets[@]}"} --verify-tag --title "v$1" --notes "$2"
}

# The release notes for v$1 (native $2, build $3) since the previous tag.
release_notes() {
  local prev notes
  prev=$(git tag --list 'v[0-9]*' --sort=-version:refname | grep -vx "v$1" | head -1 || true)
  [ -n "$prev" ] || prev=$(git rev-list --max-parents=0 HEAD | head -1)
  notes=$(node scripts/release-notes.mjs "$prev" "v$1" "$1" "$2" "$3")
  if [ -f "docs/release-notes/v$1.txt" ]; then
    notes="$(cat "docs/release-notes/v$1.txt")"$'\n\n'"$notes"
  fi
  printf '%s\n' "$notes"
}

# What happened in each store, for the summary at the end.
STORE_RESULTS=()
store_result() { STORE_RESULTS+=("$1: $2"); }

# Uploads an .ipa (ios) or .pkg (macos) to App Store Connect, and notes the
# upload in build/asc-uploads/: App Store Connect lists a build only some
# minutes after the upload, and refuses a second upload of the same build
# number, so retry waits for a build it finds noted instead of uploading it
# again.
ASC_UPLOADS="$ROOT/build/asc-uploads"
asc_upload() {
  xcrun altool --upload-app --file "$1" --type "$2" \
    --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1 || return 1
  mkdir -p "$ASC_UPLOADS"
  cksum < "$1" > "$ASC_UPLOADS/$(basename "$1")"
}
# Whether this very file went up to App Store Connect before.
asc_uploaded() {
  [ -f "$ASC_UPLOADS/$(basename "$1")" ] && [ "$(cksum < "$1")" = "$(cat "$ASC_UPLOADS/$(basename "$1")")" ]
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
# Retry mode — finish a release: npm packages and the GitHub release that
# are missing, and the stores that are behind
# ============================================================
if [ "${1:-}" = "retry" ]; then
  ALLOW_PENDING=false
  HOLD_MACOS=false
  for arg in "${@:2}"; do
    case "$arg" in
      --allow-pending) ALLOW_PENDING=true ;;
      --hold-macos) HOLD_MACOS=true ;;
      *) echo "Usage: ./scripts/release.sh retry [--allow-pending] [--hold-macos]"; exit 1 ;;
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
  # submission and restart its review. So is one whose review state couldn't
  # be read, since it may have one (--allow-pending uploads anyway).
  STATUS_JSON=$(node scripts/store-status.mjs --json) || [ $? -eq 3 ] \
    || { echo "Error: couldn't check the stores (scripts/store-status.mjs)"; exit 1; }
  skip_pending() {
    [ "$ALLOW_PENDING" = false ] && \
      { [ "$(status_field "$1" pending)" = true ] || [ "$(status_field "$1" unknown)" = true ]; }
  }
  pending_note() {
    if [ "$(status_field "$1" pending)" = true ]; then
      echo "v$(status_field "$1" pendingVersion) is $(status_field "$1" pendingState); skipped, an upload would restart that review"
    else
      echo "NOT UPLOADED: its review state is unknown ($(status_field "$1" unknownReason)), and an upload could restart a review; run retry again, or pass --allow-pending"
    fi
  }

  RETRIED=0

  # npm: a failed `pnpm publish` stops the release after the tag is pushed.
  # What's missing is published from the tagged commit, rebuilt first.
  NPM_MISSING=false
  for pkg in "${NPM_PACKAGES[@]}"; do
    name=$(node -p "require('./${pkg}/package.json').name")
    if [ "$(npm view "${name}@${CURRENT}" version 2>/dev/null || true)" != "$CURRENT" ]; then NPM_MISSING=true; fi
  done
  if [ "$NPM_MISSING" = false ]; then
    echo "npm: v${CURRENT} — all published"
  elif ! git tag --points-at HEAD | grep -qx "v${CURRENT}" || [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "npm: packages missing at v${CURRENT}, but this isn't a clean checkout of the tag v${CURRENT}"
    store_result "npm" "NOT PUBLISHED: run retry again from a clean checkout of v${CURRENT}"
  else
    echo "npm: publishing what's missing at v${CURRENT}..."
    if pnpm build && npm_publish_missing "$CURRENT"; then
      RETRIED=$((RETRIED + 1))
      store_result "npm" "published"
    else
      store_result "npm" "FAILED (see the log above)"
    fi
  fi

  # GitHub release
  if gh release view "v${CURRENT}" >/dev/null 2>&1; then
    echo "GitHub release: v${CURRENT} — exists"
  elif github_release "$CURRENT" "$(release_notes "$CURRENT" "$NATIVE_VERSION" "$VERSION_CODE")"; then
    RETRIED=$((RETRIED + 1))
    store_result "GitHub release" "created"
  else
    store_result "GitHub release" "FAILED (see the log above)"
  fi

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
    elif [ "$(node -p "require('./packages/extension/.output/firefox-mv2/manifest.json').version" 2>/dev/null)" != "$CURRENT" ]; then
      echo "Firefox: packages/extension/.output/firefox-mv2 isn't a v${CURRENT} build"
      store_result "Firefox Add-ons" "FAILED: no v${CURRENT} build in packages/extension/.output/firefox-mv2"
    elif ! check_source_zip "dist/byoky-source-v${CURRENT}.zip"; then
      store_result "Firefox Add-ons" "FAILED: dist/byoky-source-v${CURRENT}.zip doesn't rebuild the add-on"
    else
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
  # never got is uploaded again, and one still processing, or uploaded but
  # not listed yet, is waited for.
  if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
    for platform in IOS MAC_OS; do
      if [ "$platform" = IOS ]; then
        label="App Store (iOS)"; file="dist/byoky-ios-v${CURRENT}.ipa"; type=ios
      else
        label="App Store (macOS)"; file="dist/byoky-macos-v${CURRENT}.pkg"; type=macos
      fi
      if [ "$platform" = MAC_OS ] && [ "$HOLD_MACOS" = true ]; then
        echo "${label}: held (--hold-macos); nothing asked or uploaded"
        store_result "$label" "held (--hold-macos)"
        continue
      fi
      echo "${label}: checking..."
      appstore_submit "$platform" "$NATIVE_VERSION" 0
      if [ "$ASC_CODE" -eq 3 ] && [ -f "$file" ] && asc_uploaded "$file"; then
        echo "${label}: ${file} was uploaded already; waiting for App Store Connect to list the build..."
        appstore_submit "$platform" "$NATIVE_VERSION"
        if [ "$ASC_CODE" -eq 3 ]; then
          ASC_RESULT="NO BUILD in App Store Connect, although ${file} was uploaded; see App Store Connect and Apple's email about that build"
        fi
      elif [ "$ASC_CODE" -eq 3 ] && [ ! -f "$file" ]; then
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
    case "$r" in *FAILED*|*"NO BUILD"*|*"NOT PUBLISHED"*|*"NOT UPLOADED"*) exit 1 ;; esac
  done
  exit 0
fi

# --- Parse args ---
DRY_RUN=false
SKIP_MOBILE=false
SKIP_STORE_UPLOADS=false
ASSUME_YES=false
ALLOW_PENDING=false
HOLD_MACOS=false
ALLOW_BRANCH=false
ALLOW_DIRTY=false
SKIP_NATIVE_TESTS=false
NEW_VERSION=""

for arg in "$@"; do
  case "$arg" in
    --dry)     DRY_RUN=true ;;
    --skip-mobile) SKIP_MOBILE=true ;;
    --skip-store-uploads) SKIP_STORE_UPLOADS=true ;;
    --yes)     ASSUME_YES=true ;;
    --allow-pending) ALLOW_PENDING=true ;;
    --hold-macos) HOLD_MACOS=true ;;
    --allow-branch) ALLOW_BRANCH=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    --skip-native-tests) SKIP_NATIVE_TESTS=true ;;
    *)         NEW_VERSION="$arg" ;;
  esac
done

if [ -z "$NEW_VERSION" ]; then
  CURRENT=$(node -p "require('./package.json').version")
  echo "Usage: ./scripts/release.sh <new-version> [--dry] [--skip-mobile] [--skip-store-uploads] [--yes]"
  echo "                                           [--allow-pending] [--hold-macos] [--allow-branch]"
  echo "                                           [--allow-dirty] [--skip-native-tests]"
  echo "       ./scripts/release.sh status"
  echo "       ./scripts/release.sh retry [--allow-pending] [--hold-macos]"
  echo ""
  echo "  --dry                  Run the checks and the tests and print the plan; nothing"
  echo "                         is bumped or published, and signing is only checked"
  echo "  --skip-mobile          Skip iOS/macOS/Android builds and uploads"
  echo "  --skip-store-uploads   Build + npm publish + GitHub release, but skip"
  echo "                         Chrome/Firefox/App Store/Play uploads"
  echo "  --yes                  Don't ask before starting (non-interactive runs)"
  echo "  --allow-pending        Release although a store has a review pending, or its"
  echo "                         review state can't be read (an upload restarts a pending"
  echo "                         review; --yes doesn't imply it)"
  echo "  --hold-macos           Ship everything but the Mac app: macOS is built but not"
  echo "                         uploaded or submitted, and only its pending review is"
  echo "                         ignored (other stores' reviews still stop the release)."
  echo "                         retry uploads and submits it later; App Store Connect"
  echo "                         takes it once the macOS version in review is through."
  echo "                         With retry: leave macOS out of that run"
  echo "  --allow-branch         Release from a branch other than main (e.g. a worktree);"
  echo "                         HEAD must contain origin/main, and the release commit is"
  echo "                         pushed to main all the same"
  echo "  --allow-dirty          Release with uncommitted or untracked files: they are"
  echo "                         built and shipped but NOT committed or tagged"
  echo "  --skip-native-tests    Skip the Android and iOS unit tests (the JS build,"
  echo "                         typecheck and tests always run)"
  echo ""
  echo "Releases go out from main: fast-forward main to the work, release from the main"
  echo "checkout. The release commit and tag v<version> are pushed to origin main."
  echo "retry finishes a release that stopped after the push: it publishes the npm"
  echo "packages and the GitHub release that are missing and uploads to the stores that"
  echo "are behind. A run that stopped earlier says how to undo its version bump."
  echo "While another macOS version is in review, retry neither uploads nor submits the"
  echo "Mac app (App Store Connect refuses a second version); a later retry does."
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

# A run that failed between the bump and the commit leaves a bumped tree.
HEAD_VERSION=$(git show HEAD:package.json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).version)')
if [ "$OLD_VERSION" != "$HEAD_VERSION" ]; then
  ERRORS+=("package.json has ${OLD_VERSION} but the last commit ${HEAD_VERSION}: an earlier run bumped the tree and stopped before committing, so nothing of it was published. Undo the bump (git checkout -- ${VERSION_FILES[*]} ${MOBILE_BUNDLES[*]}) and run again")
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

# Without the upload keystore gradle builds an unsigned AAB, which Google Play
# refuses at the very end of the run.
if [ "$SKIP_ANDROID" = false ] && [ "$SKIP_STORE_UPLOADS" = false ] && \
   [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ] && [ ! -f packages/android/keystore.properties ]; then
  ERRORS+=("packages/android/keystore.properties is missing: the AAB would be unsigned and Google Play refuses it")
fi

# The OpenClaw install scan runs on the built plugin before anything is
# committed (step 2).
if [ ! -f scripts/scan-openclaw-plugin.mjs ]; then
  ERRORS+=("scripts/scan-openclaw-plugin.mjs is missing")
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

if [ "$HOLD_MACOS" = true ] && [ "$SKIP_IOS" = false ] && [ "$SKIP_STORE_UPLOADS" = false ]; then
  WARNINGS+=("--hold-macos: the Mac app is built but not uploaded or submitted; ./scripts/release.sh retry does that once the macOS version in review is through")
fi

# No store credentials at all usually means .env / .env.local didn't load
# (e.g. a worktree): the release would publish to npm and upload nothing.
if [ ${#STORES_CONFIGURED[@]} -eq 0 ] && [ "$SKIP_STORE_UPLOADS" = false ]; then
  ERRORS+=("No store credentials (.env / .env.local); pass --skip-store-uploads for an npm + GitHub-only release")
fi

[ -n "${DISCORD_WEBHOOK_URL:-}" ] \
  && STORES_CONFIGURED+=("Discord") \
  || STORES_SKIPPED+=("Discord (DISCORD_WEBHOOK_URL)")

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
  if [ "$NEW_NATIVE_VERSION" = "$OLD_NATIVE_VERSION" ]; then
    echo "       If v${NEW_VERSION} was released already but didn't reach every store or npm,"
    echo "       ./scripts/release.sh retry finishes it."
  fi
  exit 1
fi

# --- Check store statuses ---
# Before anything is bumped: an upload to a store with a submission still in
# review replaces that submission and restarts its review. A store whose
# review state couldn't be read counts the same (store-status.mjs exit 3).
echo "==> Checking store statuses..."
STATUS_CODE=0
STATUS_ARGS=()
# The held Mac app isn't uploaded, so its review doesn't hold the rest up.
if [ "$HOLD_MACOS" = true ]; then STATUS_ARGS+=(--ignore=appstore-macos); fi
node scripts/store-status.mjs ${STATUS_ARGS[@]+"${STATUS_ARGS[@]}"} || STATUS_CODE=$?
echo ""
if [ "$STATUS_CODE" -eq 3 ] && [ "$ALLOW_PENDING" = true ]; then
  echo "  WARN: a review is pending, or a store's review state is unknown (above); --allow-pending releases anyway."
  echo ""
elif [ "$STATUS_CODE" -eq 3 ]; then
  echo "Error: a review is pending, or a store's review state couldn't be read (above). Wait until"
  echo "       the review is through or the check works, or pass --allow-pending."
  exit 1
elif [ "$STATUS_CODE" -ne 0 ]; then
  echo "Error: couldn't check the stores (scripts/store-status.mjs exit $STATUS_CODE)."
  exit 1
fi

# --- Verify ---
# What ships has to build and pass its tests: the JS packages always, the
# Android and iOS unit tests unless --skip-native-tests.
echo "==> Verifying (install, build, typecheck, tests)..."
verify() {
  echo "  \$ $*"
  if ! "$@"; then
    echo "Error: '$*' failed. Nothing was bumped or published."
    exit 1
  fi
}
verify pnpm install --frozen-lockfile
verify pnpm build:core
verify pnpm build:sdk
verify pnpm --filter @byoky/bridge build
verify pnpm --filter @byoky/extension exec wxt prepare
verify pnpm typecheck
verify pnpm test
verify node --test scripts/tests/*.test.mjs
if [ "$SKIP_NATIVE_TESTS" = true ]; then
  echo "  WARN: --skip-native-tests: the Android and iOS unit tests didn't run"
else
  if [ "$SKIP_ANDROID" = false ]; then
    verify bash -c 'cd packages/android && ./gradlew :app:testDebugUnitTest'
  fi
  if [ "$SKIP_IOS" = false ]; then
    verify run_ios_tests
  fi
fi
echo ""

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
if [ "$SKIP_IOS" = false ] && [ "$HOLD_MACOS" = true ]; then
  echo "│    7. Archive iOS & macOS, upload iOS to App Store (macOS held for retry)"
elif [ "$SKIP_IOS" = false ]; then
  echo "│    7. Archive + upload iOS & macOS to App Store"
fi
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

# From here on a failure leaves work behind; say what and how to go on.
STAGE=bumped
on_exit() {
  local code=$?
  [ "$code" -eq 0 ] && return
  echo ""
  case "$STAGE" in
    bumped)
      echo "The release stopped after the version bump. Nothing was committed or published."
      echo "Undo the bump, then run it again:"
      echo "  git checkout -- ${VERSION_FILES[*]} ${MOBILE_BUNDLES[*]}" ;;
    committed)
      echo "The release stopped after committing and tagging v${NEW_VERSION} locally; nothing was pushed or published."
      echo "Push both, then finish with retry:"
      echo "  git push --atomic origin HEAD:main v${NEW_VERSION} && ./scripts/release.sh retry" ;;
    pushed)
      echo "v${NEW_VERSION} is tagged on origin, but npm, the stores or the GitHub release didn't all get it."
      echo "Finish with: ./scripts/release.sh retry" ;;
    released)
      echo "v${NEW_VERSION} is out; a step after the GitHub release failed (see above)." ;;
  esac
}
trap on_exit EXIT

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

# OpenClaw refuses to install a plugin its scanner flags, so check the one
# about to be published before anything is committed.
echo "  Scanning the OpenClaw plugin..."
if ! node scripts/scan-openclaw-plugin.mjs; then
  echo "Error: the OpenClaw install scan failed."
  exit 1
fi

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
# zip -r adds to an archive that's already there: an earlier run's hashed
# chunks would ship next to this build's. Start from nothing.
rm -f dist/byoky-*-v"${NEW_VERSION}".* dist/byoky-*-v"${NEW_VERSION}"-*

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

# Source for AMO, whose reviewers rebuild the add-on from it: the workspace
# files the build reads (all three packages extend tsconfig.base.json) and
# BUILD-FIREFOX.md. The add-on goes to AMO only if the zip rebuilds it.
SOURCE_ZIP="dist/byoky-source-v${NEW_VERSION}.zip"
zip -r "$SOURCE_ZIP" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json README.md \
  packages/core packages/sdk packages/extension \
  -x "*/node_modules/*" "*/dist/*" "*/.output/*" "*/.wxt/*" "*.DS_Store"
NOTE_DIR=$(mktemp -d)
amo_build_note > "$NOTE_DIR/BUILD-FIREFOX.md"
zip -j "$SOURCE_ZIP" "$NOTE_DIR/BUILD-FIREFOX.md"
rm -rf "$NOTE_DIR"
echo "  Rebuilding the Firefox add-on from the source zip..."
if check_source_zip "$SOURCE_ZIP"; then
  AMO_SOURCE_OK=true
else
  AMO_SOURCE_OK=false
  echo "  WARN: the Firefox add-on won't be uploaded to AMO with source that doesn't rebuild it"
fi

echo "  Artifacts:"
ls -lh dist/byoky-*-v${NEW_VERSION}.* 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}'

# ============================================================
# 4. Git commit + tag
# ============================================================
step "Git commit + tag"

# Stage all version-bumped files, and the synced mobile bundles if they changed
git add "${VERSION_FILES[@]}"
for f in "${MOBILE_BUNDLES[@]}"; do git add "$f" 2>/dev/null || true; done

# The tree was clean before the bump, so anything still unstaged was changed
# by the build. It's derived from the tagged sources, but say so.
LEFT_OVER=$(git status --porcelain --untracked-files=normal | grep -v '^[MADRC] ' || true)
if [ -n "$LEFT_OVER" ] && [ "$ALLOW_DIRTY" = false ]; then
  echo "  WARN: the build changed files that the release commit leaves out:"
  echo "$LEFT_OVER" | sed 's/^/    /'
fi

git commit -m "Bump to v${NEW_VERSION} (native ${NEW_NATIVE_VERSION}/${NEW_VERSION_CODE})"
git tag "v${NEW_VERSION}"
STAGE=committed

echo "  Committed and tagged v${NEW_VERSION}"

# Push commit + tag to main, together or not at all. HEAD contains
# origin/main (pre-flight), so this is a fast-forward from any branch.
echo "  Pushing to origin main..."
git push --atomic origin HEAD:main "refs/tags/v${NEW_VERSION}"
STAGE=pushed

# ============================================================
# 5. Generate release notes
# ============================================================
step "Generate release notes"

PREV_TAG=$(git tag --list 'v*' --sort=-version:refname | sed -n '2p')
if [ -z "$PREV_TAG" ]; then
  PREV_TAG=$(git rev-list --max-parents=0 HEAD | head -1)
fi

RELEASE_NOTES=$(release_notes "$NEW_VERSION" "$NEW_NATIVE_VERSION" "$NEW_VERSION_CODE")
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

npm_publish_missing "$NEW_VERSION"

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
elif [ "$AMO_SOURCE_OK" = false ] && [ -n "${AMO_API_KEY:-}" ]; then
  echo "  Skipping Firefox Add-ons: the source zip doesn't rebuild the add-on (step 3)"
  store_result "Firefox Add-ons" "NOT UPLOADED: the source zip doesn't rebuild the add-on; fix it, then ./scripts/release.sh retry"
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
    if [ "$platform" = MAC_OS ] && [ "$HOLD_MACOS" = true ]; then
      echo "  Holding ${label} (--hold-macos): ${file} is built, not uploaded"
      store_result "$label" "HELD (--hold-macos): ${file} not uploaded; ./scripts/release.sh retry uploads and submits it once the macOS version in review is through"
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

github_release "$NEW_VERSION" "$RELEASE_NOTES"
STAGE=released

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
for f in ${RELEASE_ASSETS[@]+"${RELEASE_ASSETS[@]}"}; do
  SIZE=$(ls -lh "$f" | awk '{print $5}')
  echo "    $(basename "$f") ($SIZE)"
done
