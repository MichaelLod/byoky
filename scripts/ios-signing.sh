#!/usr/bin/env bash
# Headless iOS/macOS release signing, no Xcode account or keychain prompts.
#
# Keeps the signing identities in a dedicated keychain whose password lives in
# the gitignored .env.local (BYOKY_SIGNING_KEYCHAIN_PASSWORD), so codesign can
# run from any session (ssh, su, terminal multiplexers) where macOS can't show
# its "allow access to key" dialog. Certificates and App Store profiles are
# created through the App Store Connect API key, which also renews them when
# they expire.
#
# Idempotent: creates only what's missing. scripts/release.sh runs it before
# any version bump; run it by hand on a new Mac or after a certificate expired.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for envfile in .env .env.local; do
  if [ -f "$envfile" ]; then
    set -a
    source "$envfile"
    set +a
  fi
done

: "${ASC_KEY_ID:?ASC_KEY_ID missing}" "${ASC_ISSUER_ID:?ASC_ISSUER_ID missing}" "${ASC_PRIVATE_KEY:?ASC_PRIVATE_KEY missing}"

SIGNING_KEYCHAIN="$HOME/Library/Keychains/byoky-signing.keychain-db"
LOGIN_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
ASC_KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- API key file, where xcodebuild and altool look for it ---
if [ ! -f "$ASC_KEY_FILE" ]; then
  mkdir -p "$(dirname "$ASC_KEY_FILE")"
  printf '%b\n' "$ASC_PRIVATE_KEY" > "$ASC_KEY_FILE"
  echo "  Wrote $ASC_KEY_FILE"
fi

# --- Keychain ---
if [ ! -f "$SIGNING_KEYCHAIN" ]; then
  if [ -z "${BYOKY_SIGNING_KEYCHAIN_PASSWORD:-}" ]; then
    BYOKY_SIGNING_KEYCHAIN_PASSWORD=$(openssl rand -hex 24)
    printf '\n# Dedicated keychain for iOS/macOS release signing (scripts/ios-signing.sh)\nBYOKY_SIGNING_KEYCHAIN_PASSWORD=%s\n' \
      "$BYOKY_SIGNING_KEYCHAIN_PASSWORD" >> .env.local
  fi
  security create-keychain -p "$BYOKY_SIGNING_KEYCHAIN_PASSWORD" "$SIGNING_KEYCHAIN"
  security set-keychain-settings "$SIGNING_KEYCHAIN"
  echo "  Created $SIGNING_KEYCHAIN"
fi
: "${BYOKY_SIGNING_KEYCHAIN_PASSWORD:?BYOKY_SIGNING_KEYCHAIN_PASSWORD missing from .env.local}"
security unlock-keychain -p "$BYOKY_SIGNING_KEYCHAIN_PASSWORD" "$SIGNING_KEYCHAIN"
if ! security list-keychains -d user | grep -q "byoky-signing.keychain-db"; then
  security list-keychains -d user -s "$LOGIN_KEYCHAIN" "$SIGNING_KEYCHAIN"
fi

# --- Identities: one per certificate type, created when missing or expired ---
CREATED=false
ensure_identity() {
  local type="$1" prefix="$2" policy="$3"
  if security find-identity -v -p "$policy" "$SIGNING_KEYCHAIN" | grep -q "\"$prefix"; then
    return
  fi
  openssl genrsa -traditional -out "$WORK/$type.key" 2048 2>/dev/null
  openssl req -new -key "$WORK/$type.key" -subj "/CN=Byoky Release Signing" -out "$WORK/$type.csr"
  node scripts/ios-signing.mjs cert "$type" "$WORK/$type.csr" "$WORK/$type.cer"
  security import "$WORK/$type.key" -k "$SIGNING_KEYCHAIN" -t priv -f openssl \
    -T /usr/bin/codesign -T /usr/bin/productbuild -T /usr/bin/xcodebuild >/dev/null
  security import "$WORK/$type.cer" -k "$SIGNING_KEYCHAIN" >/dev/null
  CREATED=true
}
ensure_identity DEVELOPMENT "Apple Development:" codesigning
ensure_identity DISTRIBUTION "Apple Distribution:" codesigning
ensure_identity MAC_INSTALLER_DISTRIBUTION "3rd Party Mac Developer Installer:" basic
if [ "$CREATED" = true ]; then
  security set-key-partition-list -S apple-tool:,apple: -s -k "$BYOKY_SIGNING_KEYCHAIN_PASSWORD" "$SIGNING_KEYCHAIN" >/dev/null
fi

# --- App Store profiles for the current Apple Distribution certificate ---
node scripts/ios-signing.mjs profiles

# --- Smoke test: codesign must work without a prompt ---
cp /usr/bin/true "$WORK/signtest"
DEV_IDENTITY=$(security find-identity -v -p codesigning "$SIGNING_KEYCHAIN" | awk '/"Apple Development:/ {print $2; exit}')
if ! codesign -f --keychain "$SIGNING_KEYCHAIN" -s "$DEV_IDENTITY" "$WORK/signtest" 2>"$WORK/codesign.err"; then
  echo "Error: codesign failed: $(cat "$WORK/codesign.err")"
  exit 1
fi
echo "  Signing ready ($SIGNING_KEYCHAIN)"
