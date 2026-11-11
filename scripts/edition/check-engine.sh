#!/usr/bin/env bash
# Fail when this language app has changed engine files (docs/editions.md, books#58).
#
# usage: scripts/edition/check-engine.sh
#
# Since the last books commit merged here, only the app's own paths may differ: engine changes are made
# in books and arrive through scripts/edition/sync-upstream.sh.
set -euo pipefail

UPSTREAM=${UPSTREAM:-https://github.com/freeappstore-online/books.git}
OWN=(edition README.md fas.json .github/workflows/deploy.yml)

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet "$UPSTREAM" main
base=$(git merge-base HEAD FETCH_HEAD)
changed=$(git diff --name-only "$base" HEAD -- . "${OWN[@]/#/:!}")
if [ -n "$changed" ]; then
  echo "Engine files changed here since books ${base:0:7}:" >&2
  echo "$changed" | sed 's/^/  /' >&2
  echo "Make engine changes in books; they arrive here through the sync (docs/editions.md)." >&2
  exit 1
fi
echo "Engine files match books ${base:0:7}."
