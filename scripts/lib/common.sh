#!/usr/bin/env bash
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

# Disable colors when not connected to a terminal
if [[ ! -t 1 ]]; then
  RED='' GREEN='' YELLOW='' BLUE='' BOLD='' RESET=''
fi

# ── Logging ──────────────────────────────────────────────────────────────────
info()  { printf "${BLUE}▸${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${RESET} %s\n" "$*" >&2; }
error() { printf "${RED}✖${RESET} %s\n" "$*" >&2; }
die()   { error "$@"; exit 1; }

# ── Prompts ──────────────────────────────────────────────────────────────────
# confirm "message" [y|n]   — default answer is second arg (y if omitted)
confirm() {
  local msg="$1" default="${2:-y}"
  local prompt
  if [[ "$default" == "y" ]]; then
    prompt="[Y/n]"
  else
    prompt="[y/N]"
  fi
  printf "${BOLD}%s %s${RESET} " "$msg" "$prompt"
  read -r answer
  answer="${answer:-$default}"
  [[ "${answer,,}" == "y" ]]
}

# ── Assertions ───────────────────────────────────────────────────────────────
require_cmd() {
  command -v "$1" &>/dev/null || die "Required command not found: $1"
}

require_clean_worktree() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "Working tree has uncommitted changes. Commit or stash them first."
  fi
}

# ── Repo root ────────────────────────────────────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || die "Not inside a git repository"
