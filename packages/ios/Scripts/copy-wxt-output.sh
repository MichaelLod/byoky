#!/bin/bash
# Copies WXT Safari extension build output into the native iOS project.
# Run after: pnpm --filter @byoky/extension build:safari

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$PROJECT_DIR")")"

WXT_OUTPUT="$REPO_ROOT/packages/extension/.output/safari-mv2"
DEST="$PROJECT_DIR/SafariExtension/Resources"

if [ ! -d "$WXT_OUTPUT" ]; then
    echo "Error: WXT Safari output not found at $WXT_OUTPUT"
    echo "Run: pnpm --filter @byoky/extension build:safari"
    exit 1
fi

echo "Copying WXT output → SafariExtension/Resources/"

# Clean destination (except .gitkeep)
find "$DEST" -mindepth 1 -not -name '.gitkeep' -delete 2>/dev/null || true

# Copy all WXT output
cp -R "$WXT_OUTPUT/"* "$DEST/"

# Copy mascot and icons from extension public
cp "$REPO_ROOT/packages/extension/public/mascot.svg" "$DEST/" 2>/dev/null || true

echo "Done. Files copied:"
find "$DEST" -type f | wc -l | xargs echo "  Total files:"
