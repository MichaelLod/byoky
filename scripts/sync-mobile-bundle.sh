#!/usr/bin/env bash
#
# Sync the @byoky/core mobile bundle into the iOS and Android app trees.
#
# The mobile apps embed dist/mobile.js (built by `pnpm --filter @byoky/core
# build`) so the native TranslationEngine on each platform can run the same
# pure-JS translate layer that the extension uses. This script keeps the two
# embedded copies in sync with the canonical core build output.
#
# Usage: ./scripts/sync-mobile-bundle.sh
#
# Run after any change to packages/core/src/translate/. Mobile builds depend on
# the embedded copies, not the dist/ output, so a stale embed = broken mobile.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/core/dist/mobile.js"
IOS_DST="$ROOT/packages/ios/Byoky/Resources/mobile.js"
ANDROID_DST="$ROOT/packages/android/app/src/main/assets/mobile.js"

if [ ! -f "$SRC" ]; then
  echo "error: $SRC not found. Run 'pnpm --filter @byoky/core build' first." >&2
  exit 1
fi

mkdir -p "$(dirname "$IOS_DST")"
mkdir -p "$(dirname "$ANDROID_DST")"

cp "$SRC" "$IOS_DST"
cp "$SRC" "$ANDROID_DST"

bytes=$(wc -c < "$SRC" | tr -d ' ')
echo "synced mobile bundle ($bytes bytes)"
echo "  → $IOS_DST"
echo "  → $ANDROID_DST"
