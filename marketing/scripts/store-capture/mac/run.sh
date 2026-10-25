#!/bin/zsh
# Renders the Mac app window's page (extension on) for the Mac App Store slides.
# Output: marketing/raw/store-mac/mac-app.png (425×325 pt at 4x).
set -euo pipefail
HERE=${0:A:h}
ROOT=${HERE:h:h:h:h}
WORK=$ROOT/marketing/.cache/mac-store
OUT=$ROOT/marketing/raw/store-mac
mkdir -p $WORK $OUT
rm -rf $WORK/Resources
cp -R $ROOT/packages/ios/macOS/Resources $WORK/Resources
cp $ROOT/packages/ios/Fonts/*.ttf $WORK/Resources/   # the app bundles these next to Style.css
swiftc -O -o $WORK/snap $HERE/snap.swift 2>&1 | grep -v warning || true
$WORK/snap $WORK/Resources $OUT/mac-app.png true 4
