#!/bin/zsh
# Captures the iPhone 6.9" and iPad 13" screens for the store images from a
# scratch copy of packages/ios with a fake-data seed (MarketingSeed.swift) and
# the StoreShots UI test. The repo's iOS sources are never modified.
#
#   zsh marketing/scripts/store-capture/ios/run.sh            # iPhone + iPad
#   DEVICES="iPhone 18 Pro Max" zsh .../run.sh                 # one device
#
# Output: marketing/raw/store-ios/{iphone,ipad}-*.png at native resolution.
set -euo pipefail
HERE=${0:A:h}
ROOT=${HERE:h:h:h:h}
WORK=$ROOT/marketing/.cache/ios-store
OUT=$ROOT/marketing/raw/store-ios
CONFIG=/tmp/byoky-store-config.json
if [ -n "${DEVICES:-}" ]; then DEVICES=("${(@s:,:)DEVICES}"); else DEVICES=("iPhone 18 Pro Max" "iPad Pro 13-inch (M5)"); fi

mkdir -p $WORK $OUT
rsync -a --delete --exclude .DS_Store --exclude build --exclude xcuserdata --exclude Byoky.xcodeproj \
  $ROOT/packages/ios/ $WORK/src/
cp $HERE/MarketingSeed.swift $WORK/src/Byoky/Services/
cp $HERE/StoreShots.swift $WORK/src/ByokyUITests/

# Use our own config file and call the seed after the DEBUG auto-setup.
APP=$WORK/src/Byoky/App/ByokyApp.swift
sed -i '' 's#/tmp/byoky-ios-test-config.json#'$CONFIG'#' $APP
perl -0pi -e 's/(try\? w\.addCredential\(providerId: "openai", label: "OpenAI", apiKey: openaiKey\)\n\s*\})/$1\n            w.seedMarketingData(config)/' $APP
grep -q 'seedMarketingData' $APP || { echo "seed hook did not apply to ByokyApp.swift" >&2; exit 1; }

# Placeholder keys only. The wallet shows labels and masked keys, never these.
cat > $CONFIG <<JSON
{
  "password": "Muninn-Demo-2026!",
  "anthropicKey": "sk-ant-api03-PLACEHOLDER-not-a-real-key-000000000000004f2c",
  "openaiKey": "sk-proj-PLACEHOLDER-not-a-real-key-0000000000000000a91e",
  "geminiKey": "AIzaPLACEHOLDER-not-a-real-key-00000007bd3",
  "marketingSeed": true
}
JSON

(cd $WORK/src && xcodegen generate --quiet)

for DEVICE in "${DEVICES[@]}"; do
  UDID=$(xcrun simctl list devices available | grep -F "    $DEVICE (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
  [ -n "$UDID" ] || { echo "no simulator named $DEVICE" >&2; exit 1; }
  echo "→ $DEVICE ($UDID)"
  xcrun simctl boot $UDID 2>/dev/null || true
  xcrun simctl bootstatus $UDID -b >/dev/null
  # iPad: larger Dynamic Type, so the phone-style layout reads at iPad size.
  if [[ "$DEVICE" == iPad* ]]; then xcrun simctl ui $UDID content_size extra-extra-extra-large; else xcrun simctl ui $UDID content_size large; fi
  xcrun simctl status_bar $UDID override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState discharging --batteryLevel 100
  TEST_RUNNER_STORE_OUT=$OUT caffeinate -ims xcodebuild \
    -project $WORK/src/Byoky.xcodeproj -scheme Byoky \
    -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath $WORK/dd \
    test -only-testing:ByokyUITests/StoreShots > $WORK/test-${DEVICE// /_}.log 2>&1 || true
  grep -E 'error:|Executed|BUILD FAILED|failed' $WORK/test-${DEVICE// /_}.log | head -20
done
rm -f $CONFIG
ls -1 $OUT
