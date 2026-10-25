#!/bin/zsh
# Builds a debug APK from a scratch copy of packages/android with the fake-data
# seed (MarketingSeed.kt) wired into MainActivity behind BuildConfig.DEBUG and
# the `byoky_store_seed` intent extra. The repo's Android sources are never
# modified. Output: marketing/.cache/android-store/app-debug.apk
set -euo pipefail
HERE=${0:A:h}
ROOT=${HERE:h:h:h:h}
WORK=$ROOT/marketing/.cache/android-store
mkdir -p $WORK
rsync -a --delete --exclude .DS_Store --exclude build --exclude .gradle --exclude byoky-upload.keystore --exclude keystore.properties \
  $ROOT/packages/android/ $WORK/src/
PKG=$WORK/src/app/src/main/java/com/byoky/app
cp $HERE/MarketingSeed.kt $PKG/
perl -0pi -e 's/(\n(\s*)setContent \{)/\n$2if (BuildConfig.DEBUG && intent.getBooleanExtra("byoky_store_seed", false)) {\n$2    kotlinx.coroutines.runBlocking { MarketingSeed.run(wallet) }\n$2}\n$1/' $PKG/MainActivity.kt
grep -q 'MarketingSeed.run' $PKG/MainActivity.kt || { echo "seed hook did not apply to MainActivity.kt" >&2; exit 1; }
cd $WORK/src
caffeinate -ims ./gradlew :app:assembleDebug -q 2>&1 | grep -E "^e:|FAILED|error:" || true
cp app/build/outputs/apk/debug/app-debug.apk $WORK/app-debug.apk
ls -la $WORK/app-debug.apk
