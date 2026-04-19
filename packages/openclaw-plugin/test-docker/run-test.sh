#!/usr/bin/env bash
set -euo pipefail

BRIDGE_PORT="${BRIDGE_PORT:-19280}"
BRIDGE_PID=""
WORKSPACE="/test/workspace"
AGENT_NAME="byoky-test"
MODEL_ID="byoky-anthropic/claude-haiku-4-5-20251001"

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  printf 'FAIL: ANTHROPIC_API_KEY not set — pass it via docker run --env-file .env.local\n' >&2
  exit 1
fi

cleanup() {
  if [ -n "$BRIDGE_PID" ]; then
    kill "$BRIDGE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '\nFAIL: %s\n' "$1" >&2; exit 1; }

step "Start byoky bridge proxy on :$BRIDGE_PORT (forwarding to real upstreams)"
node bridge.mjs &
BRIDGE_PID=$!

for _ in $(seq 1 25); do
  if curl -fsS "http://127.0.0.1:$BRIDGE_PORT/health" > /dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
curl -fsS "http://127.0.0.1:$BRIDGE_PORT/health" || fail "fake bridge never came up"
echo

step "OpenClaw is installed"
openclaw --version || fail "openclaw CLI missing"

step "byoky plugin is present in 'openclaw plugins list'"
openclaw plugins list --json 2>/dev/null | grep -qi byoky \
  || openclaw plugins list 2>/dev/null | grep -qi byoky \
  || fail "byoky plugin not detected by 'openclaw plugins list'"

step "'openclaw plugins doctor' reports no load errors"
openclaw plugins doctor || fail "plugins doctor reported errors"

step "Run auth flow via meta-provider 'byoky' (fast path — bridge is already healthy, no browser)"
export BYOKY_TEST_PROVIDER=anthropic
openclaw models auth login --provider byoky \
  || fail "auth login --provider byoky exited non-zero"

step "Every provider the bridge reports is registered in 'openclaw models list'"
openclaw models list --json 2>/dev/null | grep -q 'byoky-anthropic' \
  || openclaw models list 2>/dev/null | grep -q 'byoky-anthropic' \
  || fail "byoky-anthropic not listed after 'auth login --provider byoky'"

step "Create an agent bound to $MODEL_ID"
mkdir -p "$WORKSPACE"
openclaw agents add "$AGENT_NAME" \
  --workspace "$WORKSPACE" \
  --model "$MODEL_ID" \
  --non-interactive \
  || fail "agents add failed"

step "Send a real prompt via 'openclaw agent' (hits api.anthropic.com through the bridge)"
openclaw agent \
  --agent "$AGENT_NAME" \
  --message "Reply with the single word: ready" \
  --local \
  --timeout 60 \
  2>&1 | tee /tmp/byoky-agent.out

step "Bridge recorded a successful upstream call"
curl -fsS "http://127.0.0.1:$BRIDGE_PORT/__test/requests" | tee /tmp/byoky-req.out
echo
grep -q '"provider":"anthropic"' /tmp/byoky-req.out \
  || fail "bridge recorded no anthropic requests"
grep -q '"upstreamStatus":200' /tmp/byoky-req.out \
  || fail "upstream api.anthropic.com did not return 200 — check ANTHROPIC_API_KEY / model / rewrite"

step "Bridge applied the Claude-Code first-party rewrite (tools + system)"
grep -q '"authMethod":"oauth"' /tmp/byoky-req.out \
  || fail "bridge did not detect oauth — check ANTHROPIC_API_KEY prefix (should be sk-ant-oat...)"
grep -q '"isThirdParty":true' /tmp/byoky-req.out \
  || fail "bridge did not apply third-party rewrite — OpenClaw request may have had no tools"
grep -qE '"toolsRewritten":[1-9][0-9]*' /tmp/byoky-req.out \
  || fail "bridge did not rewrite any tool names"

printf '\nOK — byoky openclaw plugin end-to-end test passed\n'
printf '     (real OAuth setup token -> bridge rewrite -> 200 from api.anthropic.com)\n'
