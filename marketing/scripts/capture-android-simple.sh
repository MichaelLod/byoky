#!/bin/bash
# Quick Android re-capture: reuses the wallet that is already on the device
# (no data wipe, no onboarding, no key entry; unlocks with the marketing
# password if needed) and re-snaps the wallet, apps, connected and settings
# frames (05–11). Run capture-android.sh for the full walk from onboarding.
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/capture-android.sh" --skip-setup "$@"
