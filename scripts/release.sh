#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- Load secrets ---
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# ============================================================
# Status check mode
# ============================================================
if [ "${1:-}" = "status" ]; then
  node scripts/store-status.mjs
  exit 0
fi

# --- Parse args ---
if [ $# -lt 1 ]; then
  CURRENT=$(node -p "require('./package.json').version")
  echo "Usage: ./scripts/release.sh <new-version>"
  echo "       ./scripts/release.sh status"
  echo "Current version: $CURRENT"
  exit 1
fi

NEW_VERSION="$1"

# Validate semver format
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be semver (e.g. 0.4.19)"
  exit 1
fi

OLD_VERSION=$(node -p "require('./package.json').version")
echo "Bumping $OLD_VERSION → $NEW_VERSION"

# --- Check store statuses before proceeding ---
echo "==> Checking store statuses..."
STORE_STATUS=$(node scripts/store-status.mjs 2>&1) || true
echo "$STORE_STATUS"
echo ""

if echo "$STORE_STATUS" | grep -qi "PENDING_REVIEW\|IN_REVIEW\|pending"; then
  echo "⚠  One or more stores have a pending review."
  echo "   Uploading now may REPLACE the pending submission and RESET the review timer."
  read -rp "   Continue anyway? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# --- Derive native versions ---
ANDROID_GRADLE="$ROOT/packages/android/app/build.gradle.kts"
OLD_VERSION_CODE=$(grep 'versionCode = ' "$ANDROID_GRADLE" | head -1 | sed 's/[^0-9]//g')
NEW_VERSION_CODE=$((OLD_VERSION_CODE + 1))

OLD_NATIVE_VERSION=$(grep 'versionName = ' "$ANDROID_GRADLE" | head -1 | sed 's/.*"\(.*\)".*/\1/')
IFS='.' read -r NV_MAJOR NV_MINOR NV_PATCH <<< "$OLD_NATIVE_VERSION"
NEW_NATIVE_VERSION="${NV_MAJOR}.${NV_MINOR}.$((NV_PATCH + 1))"

echo "Native: $OLD_NATIVE_VERSION → $NEW_NATIVE_VERSION (code $OLD_VERSION_CODE → $NEW_VERSION_CODE)"

# ============================================================
# 1. Bump versions
# ============================================================
echo "==> Bumping package.json files..."

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

echo "==> Bumping Android version..."
sed -i '' "s/versionCode = $OLD_VERSION_CODE/versionCode = $NEW_VERSION_CODE/" "$ANDROID_GRADLE"
sed -i '' "s/versionName = \"$OLD_NATIVE_VERSION\"/versionName = \"$NEW_NATIVE_VERSION\"/" "$ANDROID_GRADLE"

echo "==> Bumping iOS versions..."
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

echo "==> Bumping iOS Safari manifest..."
sed -i '' "s/\"version\":\"[^\"]*\"/\"version\":\"$NEW_VERSION\"/" packages/ios/SafariExtension/Resources/manifest.json

# ============================================================
# 2. Build
# ============================================================
echo "==> Building all packages..."
pnpm build

echo "==> Building Firefox extension..."
(cd packages/extension && npx wxt build --browser firefox)

echo "==> Building Safari extension..."
(cd packages/extension && npx wxt build --browser safari)

echo "==> Building Android AAB..."
(cd packages/android && ./gradlew bundleRelease)

# ============================================================
# 3. Create dist artifacts
# ============================================================
echo "==> Creating dist artifacts..."
mkdir -p dist

(cd packages/extension/.output/chrome-mv3 && zip -r "$ROOT/dist/byoky-chrome-v${NEW_VERSION}.zip" .)
(cd packages/extension/.output/firefox-mv2 && zip -r "$ROOT/dist/byoky-firefox-v${NEW_VERSION}.zip" .)
(cd packages/extension/.output/safari-mv2 && zip -r "$ROOT/dist/byoky-safari-v${NEW_VERSION}.zip" .)

cp packages/android/app/build/outputs/bundle/release/app-release.aab \
   "dist/byoky-android-v${NEW_VERSION}.aab"

zip -r "dist/byoky-source-v${NEW_VERSION}.zip" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml README.md \
  packages/core packages/sdk packages/extension \
  -x "*/node_modules/*" "*/dist/*" "*/.output/*"

# ============================================================
# 4. Publish to npm
# ============================================================
echo "==> Publishing to npm..."

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
# 5. Chrome Web Store
# ============================================================
if [ -n "${CHROME_EXTENSION_ID:-}" ] && [ -n "${CHROME_CLIENT_ID:-}" ]; then
  echo "==> Uploading to Chrome Web Store..."
  npx chrome-webstore-upload upload \
    --source "dist/byoky-chrome-v${NEW_VERSION}.zip" \
    --extension-id "$CHROME_EXTENSION_ID" \
    --client-id "$CHROME_CLIENT_ID" \
    --client-secret "$CHROME_CLIENT_SECRET" \
    --refresh-token "$CHROME_REFRESH_TOKEN" \
    --auto-publish
else
  echo "==> Skipping Chrome Web Store (set CHROME_EXTENSION_ID, CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN in .env)"
fi

# ============================================================
# 6. Firefox Add-ons (AMO)
# ============================================================
if [ -n "${AMO_API_KEY:-}" ] && [ -n "${AMO_API_SECRET:-}" ]; then
  echo "==> Uploading to Firefox Add-ons..."
  npx web-ext sign \
    --source-dir packages/extension/.output/firefox-mv2 \
    --api-key "$AMO_API_KEY" \
    --api-secret "$AMO_API_SECRET" \
    --channel listed \
    --upload-source-code "dist/byoky-source-v${NEW_VERSION}.zip"
else
  echo "==> Skipping Firefox Add-ons (set AMO_API_KEY, AMO_API_SECRET in .env)"
fi

# ============================================================
# 7. GitHub release
# ============================================================
echo "==> Creating GitHub release..."

gh release create "v${NEW_VERSION}" \
  "dist/byoky-chrome-v${NEW_VERSION}.zip" \
  "dist/byoky-firefox-v${NEW_VERSION}.zip" \
  "dist/byoky-safari-v${NEW_VERSION}.zip" \
  "dist/byoky-android-v${NEW_VERSION}.aab" \
  "dist/byoky-source-v${NEW_VERSION}.zip" \
  --title "v${NEW_VERSION}" \
  --generate-notes

echo ""
echo "✓ Released v${NEW_VERSION}"
echo "  npm: @byoky/{core,sdk,bridge,relay,openclaw-plugin} + create-byoky-app"
echo "  GitHub: https://github.com/MichaelLod/byoky/releases/tag/v${NEW_VERSION}"
[ -n "${CHROME_EXTENSION_ID:-}" ] && echo "  Chrome Web Store: uploaded + auto-published"
[ -n "${AMO_API_KEY:-}" ] && echo "  Firefox Add-ons: submitted for review"
