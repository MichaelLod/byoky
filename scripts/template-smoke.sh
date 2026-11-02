#!/usr/bin/env bash
# Scaffolds create-byoky-app templates with this checkout's CLI, against its
# core and sdk packed as npm would publish them, and checks that each app
# installs, builds and typechecks as its users' would: with CI set, as on
# Vercel and in GitHub Actions (without it, Next quietly installs missing
# @types packages), and without the build rewriting the app's own
# package.json or tsconfig.json. CI's templates job and release.sh run it.
#
# Usage: scripts/template-smoke.sh <template>...
#   e.g. scripts/template-smoke.sh chat multi-provider backend-relay
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ $# -eq 0 ]; then
  echo "Usage: scripts/template-smoke.sh <template>... (chat, multi-provider, backend-relay)" >&2
  exit 1
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/byoky-template-smoke.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

echo "==> Building the scaffolder; packing core and sdk as they would publish"
(cd "$ROOT" &&
  pnpm --filter @byoky/core build &&
  pnpm --filter @byoky/sdk build &&
  pnpm --filter create-byoky-app build)
mkdir -p "$WORK/pkgs"
(cd "$ROOT/packages/core" && pnpm pack --pack-destination "$WORK/pkgs")
(cd "$ROOT/packages/sdk" && pnpm pack --pack-destination "$WORK/pkgs")

smoke() {
  local template="$1" app="$WORK/smoke-$1"
  (cd "$WORK" && node "$ROOT/packages/create-byoky-app/dist/index.js" "smoke-$template" --template "$template" < /dev/null) || return 1
  # The app's @byoky/sdk and its @byoky/core are this checkout's.
  (cd "$app" && PKGS="$WORK/pkgs" node -e '
    const fs = require("fs");
    const dir = process.env.PKGS;
    const tgz = (prefix) => "file:" + dir + "/" + fs.readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(".tgz"));
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    pkg.dependencies["@byoky/sdk"] = tgz("byoky-sdk-");
    pkg.overrides = { ...pkg.overrides, "@byoky/core": tgz("byoky-core-") };
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  ') || return 1
  (cd "$app" &&
    npm install --no-audit --no-fund &&
    mkdir -p ../before-"$template" && cp package.json tsconfig.json ../before-"$template"/ &&
    CI=1 npm run build --if-present &&
    CI=1 npm run build:client --if-present &&
    npx tsc --noEmit &&
    diff -u ../before-"$template"/package.json package.json &&
    diff -u ../before-"$template"/tsconfig.json tsconfig.json)
}

FAILED=()
for template in "$@"; do
  echo ""
  echo "==> Template ${template}: scaffold, install, build, typecheck"
  smoke "$template" || FAILED+=("$template")
done

echo ""
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Template smoke FAILED: ${FAILED[*]} (see above)"
  exit 1
fi
echo "Template smoke passed: $*"
