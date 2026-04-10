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

# ============================================================
# Status check mode
# ============================================================
if [ "${1:-}" = "status" ]; then
  node scripts/store-status.mjs
  exit 0
fi

# ============================================================
# Retry mode — re-publish only stores that are behind
# ============================================================
if [ "${1:-}" = "retry" ]; then
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
  [ -n "$PREV_TAG" ] && node scripts/release-notes.mjs --store "$PREV_TAG" "v${CURRENT}" > "$STORE_NOTES_FILE"

  RETRIED=0

  # Chrome Web Store
  if [ -n "${CHROME_EXTENSION_ID:-}" ] && [ -n "${CHROME_CLIENT_ID:-}" ]; then
    CHROME_LIVE=$(node -e "
      fetch('https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=130.0&x=id%3D${CHROME_EXTENSION_ID}%26v%3D0.0.0%26uc')
        .then(r=>r.text()).then(t=>{const m=t.match(/<updatecheck[^>]+version=\"([^\"]+)\"/);console.log(m?.[1]||'unknown')})
    " 2>/dev/null)
    if [ "$CHROME_LIVE" != "$CURRENT" ] && [ -f "dist/byoky-chrome-v${CURRENT}.zip" ]; then
      echo "Chrome: v${CHROME_LIVE} → v${CURRENT}"
      npx chrome-webstore-upload upload \
        --source "dist/byoky-chrome-v${CURRENT}.zip" \
        --extension-id "$CHROME_EXTENSION_ID" \
        --client-id "$CHROME_CLIENT_ID" \
        --client-secret "$CHROME_CLIENT_SECRET" \
        --refresh-token "$CHROME_REFRESH_TOKEN" \
        --auto-publish 2>&1 || echo "  WARN: Chrome upload failed"
      RETRIED=$((RETRIED + 1))
    else
      echo "Chrome: v${CHROME_LIVE} — up to date"
    fi
  fi

  # Firefox AMO
  if [ -n "${AMO_API_KEY:-}" ] && [ -n "${AMO_API_SECRET:-}" ]; then
    AMO_LIVE=$(node -e "
      const { createHmac } = require('node:crypto');
      const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
      const now = Math.floor(Date.now()/1000);
      const p = Buffer.from(JSON.stringify({iss:'${AMO_API_KEY}',jti:Math.random().toString(36),iat:now,exp:now+60})).toString('base64url');
      const s = createHmac('sha256','${AMO_API_SECRET}').update(h+'.'+p).digest('base64url');
      fetch('https://addons.mozilla.org/api/v5/addons/addon/byoky%40byoky.com/versions/?page_size=1',{headers:{Authorization:'JWT '+h+'.'+p+'.'+s}})
        .then(r=>r.json()).then(d=>console.log(d.results?.[0]?.version||'unknown'))
    " 2>/dev/null)
    if [ "$AMO_LIVE" != "$CURRENT" ] && [ -d "packages/extension/.output/firefox-mv2" ]; then
      echo "Firefox: v${AMO_LIVE} → v${CURRENT}"
      npx web-ext sign \
        --source-dir packages/extension/.output/firefox-mv2 \
        --api-key "$AMO_API_KEY" \
        --api-secret "$AMO_API_SECRET" \
        --channel listed \
        --upload-source-code "dist/byoky-source-v${CURRENT}.zip" 2>&1 || echo "  WARN: Firefox upload failed"
      RETRIED=$((RETRIED + 1))
    else
      echo "Firefox: v${AMO_LIVE} — up to date"
    fi
  fi

  # App Store (iOS)
  if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
    echo "App Store: checking..."
    node scripts/submit-appstore.mjs "$NATIVE_VERSION" IOS "$STORE_NOTES_FILE" 2>&1 || true
    node scripts/submit-appstore.mjs "$NATIVE_VERSION" MAC_OS "$STORE_NOTES_FILE" 2>&1 || true
    RETRIED=$((RETRIED + 1))
  fi

  # Google Play
  if [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ] && [ -f "dist/byoky-android-v${CURRENT}.aab" ]; then
    GP_LIVE=$(node -e "
      fetch('https://play.google.com/store/apps/details?id=com.byoky.app&hl=en',{headers:{'User-Agent':'Mozilla/5.0'}})
        .then(r=>r.text()).then(h=>{const m=h.match(/\[\[\[\"(\d+\.\d+\.\d+)\"\]\]/)||h.match(/Current Version.*?>([\d.]+)</);console.log(m?.[1]||'unknown')})
    " 2>/dev/null)
    if [ "$GP_LIVE" != "$NATIVE_VERSION" ]; then
      echo "Google Play: v${GP_LIVE} → v${NATIVE_VERSION}"
      node scripts/upload-google-play.mjs "dist/byoky-android-v${CURRENT}.aab" production "$STORE_NOTES_FILE" 2>&1 || echo "  WARN: Google Play upload failed"
      RETRIED=$((RETRIED + 1))
    else
      echo "Google Play: v${GP_LIVE} — up to date"
    fi
  fi

  # Discord (skip on retry — already posted)

  echo ""
  if [ "$RETRIED" -eq 0 ]; then
    echo "All stores up to date."
  else
    echo "Retried $RETRIED store(s). Run 'pnpm release:status' to verify."
    node scripts/generate-versions.mjs 2>&1 || true
  fi
  exit 0
fi

# --- Parse args ---
DRY_RUN=false
SKIP_MOBILE=false
NEW_VERSION=""

for arg in "$@"; do
  case "$arg" in
    --dry)     DRY_RUN=true ;;
    --skip-mobile) SKIP_MOBILE=true ;;
    *)         NEW_VERSION="$arg" ;;
  esac
done

if [ -z "$NEW_VERSION" ]; then
  CURRENT=$(node -p "require('./package.json').version")
  echo "Usage: ./scripts/release.sh <new-version> [--dry] [--skip-mobile]"
  echo "       ./scripts/release.sh status"
  echo ""
  echo "  --dry          Print what would happen without executing"
  echo "  --skip-mobile  Skip iOS/macOS/Android builds and uploads"
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

# Check git state
if ! git diff --quiet HEAD 2>/dev/null; then
  WARNINGS+=("Working tree has uncommitted changes — they will be included in the release commit")
fi

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "dev" ] && [ "$CURRENT_BRANCH" != "main" ]; then
  WARNINGS+=("On branch '$CURRENT_BRANCH' (expected dev or main)")
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
NEW_VERSION_CODE=$((OLD_VERSION_CODE + 1))

OLD_NATIVE_VERSION=$(grep 'versionName = ' "$ANDROID_GRADLE" | head -1 | sed 's/.*"\(.*\)".*/\1/')
IFS='.' read -r NV_MAJOR NV_MINOR NV_PATCH <<< "$OLD_NATIVE_VERSION"
NEW_NATIVE_VERSION="${NV_MAJOR}.${NV_MINOR}.$((NV_PATCH + 1))"

# --- Check store statuses ---
echo "==> Checking store statuses..."
STORE_STATUS=$(node scripts/store-status.mjs 2>&1) || true
echo "$STORE_STATUS"
echo ""

if echo "$STORE_STATUS" | grep -qi "PENDING_REVIEW\|IN_REVIEW\|pending"; then
  echo "  One or more stores have a pending review."
  echo "  Uploading now may REPLACE the pending submission and RESET the review timer."
  echo ""
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
echo "│    4. Git commit + tag v${NEW_VERSION}"
echo "│    5. Publish npm packages"
echo "│    6. Upload to extension stores"
[ "$SKIP_IOS" = false ] && echo "│    7. Archive + upload iOS & macOS to App Store"
[ "$SKIP_ANDROID" = false ] && echo "│    8. Upload Android AAB to Google Play"
echo "│    9. Create GitHub release with release notes"
echo "└──────────────────────────────────────────────────────┘"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN — exiting without changes."
  exit 0
fi

read -rp "Proceed? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
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
  packages/relay/package.json
  packages/vault/package.json
  packages/web/package.json
  packages/openclaw-plugin/package.json
  packages/create-byoky-app/package.json
)

for f in "${PACKAGE_JSONS[@]}"; do
  sed -i '' "s/\"version\": \"$OLD_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$f"
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

for f in "${IOS_PLISTS[@]}"; do
  sed -i '' "s|<string>$OLD_NATIVE_VERSION</string>|<string>$NEW_NATIVE_VERSION</string>|" "$f"
  sed -i '' "s|<string>$OLD_VERSION_CODE</string>|<string>$NEW_VERSION_CODE</string>|" "$f"
done

echo "  Bumping iOS Safari manifest..."
sed -i '' "s/\"version\":\"[^\"]*\"/\"version\":\"$NEW_VERSION\"/" packages/ios/SafariExtension/Resources/manifest.json

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
  echo "  Archiving iOS app..."
  xcodebuild archive \
    -project "$IOS_DIR/Byoky.xcodeproj" \
    -scheme "Byoky" \
    -configuration Release \
    -archivePath "$BUILD_DIR/Byoky-iOS.xcarchive" \
    -destination "generic/platform=iOS" \
    CODE_SIGN_STYLE=Automatic \
    -quiet

  echo "  Exporting iOS IPA..."
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
    -quiet

  echo "  Exporting macOS app..."
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

# Stage all version-bumped files
git add \
  package.json \
  packages/*/package.json \
  packages/android/app/build.gradle.kts \
  packages/ios/Byoky/App/Info.plist \
  packages/ios/SafariExtension/Info.plist \
  packages/ios/macOS/Info.plist \
  packages/ios/macOS/SafariExtension-macOS-Info.plist \
  packages/ios/SafariExtension/Resources/manifest.json

# Also stage the synced mobile bundles if they changed
git add packages/ios/Byoky/Resources/mobile.js 2>/dev/null || true
git add packages/android/app/src/main/assets/mobile.js 2>/dev/null || true

git commit -m "Bump to v${NEW_VERSION} (native ${NEW_NATIVE_VERSION}/${NEW_VERSION_CODE})"
git tag "v${NEW_VERSION}"

echo "  Committed and tagged v${NEW_VERSION}"

# Push commit + tag
echo "  Pushing to origin..."
git push origin "$CURRENT_BRANCH"
git push origin "v${NEW_VERSION}"

# ============================================================
# 5. Generate release notes
# ============================================================
step "Generate release notes"

PREV_TAG=$(git tag --list 'v*' --sort=-version:refname | sed -n '2p')
if [ -z "$PREV_TAG" ]; then
  PREV_TAG=$(git rev-list --max-parents=0 HEAD | head -1)
fi

RELEASE_NOTES=$(node scripts/release-notes.mjs "$PREV_TAG" "v${NEW_VERSION}" "$NEW_VERSION" "$NEW_NATIVE_VERSION" "$NEW_VERSION_CODE")
echo "$RELEASE_NOTES"

# Store-formatted notes (plain text, max 500 chars) for App Store + Google Play
STORE_NOTES_FILE="$BUILD_DIR/store-notes.txt"
node scripts/release-notes.mjs --store "$PREV_TAG" "v${NEW_VERSION}" > "$STORE_NOTES_FILE"
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
  packages/relay
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

if [ -n "${CHROME_EXTENSION_ID:-}" ] && [ -n "${CHROME_CLIENT_ID:-}" ]; then
  echo "  Uploading to Chrome Web Store..."
  npx chrome-webstore-upload upload \
    --source "dist/byoky-chrome-v${NEW_VERSION}.zip" \
    --extension-id "$CHROME_EXTENSION_ID" \
    --client-id "$CHROME_CLIENT_ID" \
    --client-secret "$CHROME_CLIENT_SECRET" \
    --refresh-token "$CHROME_REFRESH_TOKEN" \
    --auto-publish
else
  echo "  Skipping Chrome Web Store (credentials not configured)"
fi

# ============================================================
# 8. Firefox Add-ons (AMO)
# ============================================================
if [ -n "${AMO_API_KEY:-}" ] && [ -n "${AMO_API_SECRET:-}" ]; then
  echo "  Uploading to Firefox Add-ons..."
  npx web-ext sign \
    --source-dir packages/extension/.output/firefox-mv2 \
    --api-key "$AMO_API_KEY" \
    --api-secret "$AMO_API_SECRET" \
    --channel listed \
    --upload-source-code "dist/byoky-source-v${NEW_VERSION}.zip"
else
  echo "  Skipping Firefox Add-ons (credentials not configured)"
fi

# ============================================================
# 9. App Store (iOS + macOS)
# ============================================================
step "Upload to App Store"

if [ "$SKIP_IOS" = false ] && [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  # Upload iOS
  IPA_FILE="dist/byoky-ios-v${NEW_VERSION}.ipa"
  if [ -f "$IPA_FILE" ]; then
    echo "  Uploading iOS to App Store Connect..."
    xcrun altool --upload-app \
      --file "$IPA_FILE" \
      --type ios \
      --apiKey "$ASC_KEY_ID" \
      --apiIssuer "$ASC_ISSUER_ID" \
      2>&1 || echo "  WARN: iOS upload failed (may need manual upload via Transporter)"
  else
    echo "  Skipping iOS upload (no IPA found — export may have uploaded directly)"
  fi

  # Upload macOS
  MACOS_PKG="dist/byoky-macos-v${NEW_VERSION}.pkg"
  if [ -f "$MACOS_PKG" ]; then
    echo "  Uploading macOS to App Store Connect..."
    xcrun altool --upload-app \
      --file "$MACOS_PKG" \
      --type macos \
      --apiKey "$ASC_KEY_ID" \
      --apiIssuer "$ASC_ISSUER_ID" \
      2>&1 || echo "  WARN: macOS upload failed (may need manual upload via Transporter)"
  else
    echo "  Skipping macOS upload (no pkg found)"
  fi

  # Wait for builds to process before submitting
  echo "  Waiting 30s for builds to process..."
  sleep 30

  # Submit iOS for review (creates version, sets release notes, selects build, submits)
  echo "  Submitting iOS for App Store review..."
  node scripts/submit-appstore.mjs "$NEW_NATIVE_VERSION" IOS "$STORE_NOTES_FILE" \
    2>&1 || echo "  WARN: iOS auto-submit failed — submit manually in App Store Connect"

  # Submit macOS for review
  echo "  Submitting macOS for App Store review..."
  node scripts/submit-appstore.mjs "$NEW_NATIVE_VERSION" MAC_OS "$STORE_NOTES_FILE" \
    2>&1 || echo "  WARN: macOS auto-submit failed — submit manually in App Store Connect"
else
  echo "  Skipping App Store uploads (${SKIP_IOS:+mobile builds skipped}${ASC_KEY_ID:+}${ASC_KEY_ID:-credentials not configured})"
fi

# ============================================================
# 10. Google Play
# ============================================================
step "Upload to Google Play"

if [ "$SKIP_ANDROID" = false ] && [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ]; then
  node scripts/upload-google-play.mjs "dist/byoky-android-v${NEW_VERSION}.aab" production "$STORE_NOTES_FILE"
else
  echo "  Skipping Google Play (${SKIP_ANDROID:+android build skipped}${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:+}${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-credentials not configured})"
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
echo "  Git:       $(git rev-parse --short HEAD) on ${CURRENT_BRANCH}"
echo "  Tag:       v${NEW_VERSION}"
echo ""
echo "  npm:"
for pkg in "${NPM_PACKAGES[@]}"; do
  echo "    @byoky/$(basename "$pkg")@${NEW_VERSION}"
done
echo "    create-byoky-app@${NEW_VERSION}"
echo ""
echo "  Stores:"
[ -n "${CHROME_EXTENSION_ID:-}" ] && echo "    Chrome Web Store: uploaded + auto-published"
[ -n "${AMO_API_KEY:-}" ] && echo "    Firefox AMO: submitted for review"
[ "$SKIP_IOS" = false ] && [ -n "${ASC_KEY_ID:-}" ] && echo "    App Store (iOS + macOS): uploaded + submitted for review"
[ "$SKIP_ANDROID" = false ] && [ -n "${GOOGLE_PLAY_SERVICE_ACCOUNT_JSON:-}" ] && echo "    Google Play: uploaded to production track"
[ -n "${DISCORD_WEBHOOK_URL:-}" ] && echo "    Discord: release announcement posted"
echo ""
echo "  GitHub: https://github.com/MichaelLod/byoky/releases/tag/v${NEW_VERSION}"
echo ""
echo "  Artifacts:"
for f in "${RELEASE_ASSETS[@]}"; do
  SIZE=$(ls -lh "$f" | awk '{print $5}')
  echo "    $(basename "$f") ($SIZE)"
done
