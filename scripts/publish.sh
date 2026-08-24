#!/usr/bin/env bash
# Create the public GitHub repository and push.
#
# Run once. It authenticates gh in your browser if needed (you are already
# signed in as NarraSnehith there, so it is a single approval), then creates the
# repo under that account and pushes every commit.
set -euo pipefail

REPO="${1:-basalt-secure-file-storage}"
DESC="Secure file storage service — resumable uploads, per-file access control, revocable links, version history, shared folders"

command -v gh >/dev/null || { echo "gh is not installed: brew install gh"; exit 1; }

if ! gh auth status >/dev/null 2>&1; then
  echo "→ Authenticating with GitHub (choose the NarraSnehith account)…"
  gh auth login --hostname github.com --git-protocol https --web
fi

WHO=$(gh api user --jq .login)
echo "→ Authenticated as ${WHO}"

gh repo create "$REPO" \
  --public \
  --source=. \
  --remote=origin \
  --description "$DESC" \
  --push

echo
echo "✔ Pushed. Repository: https://github.com/${WHO}/${REPO}"
