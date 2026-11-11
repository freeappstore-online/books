#!/usr/bin/env bash
# Merge books main into this language app, keeping the files the app owns (docs/editions.md, books#58).
#
# usage: scripts/edition/sync-upstream.sh   (in a language app's checkout, on main, with a clean tree)
#
# Upstream's changes to the engine are merged. Its changes under the app's own paths (new English books,
# its README, its fas.json) are dropped: those paths stay exactly as they are here. A conflict anywhere
# else means this app changed engine code, which only ever changes in books: the merge is aborted and
# the conflicting files are listed. Exit 0: merged, or already up to date. Exit 1: nothing changed.
set -euo pipefail

UPSTREAM=${UPSTREAM:-https://github.com/freeappstore-online/books.git}
OWN=(edition README.md fas.json .github/workflows/deploy.yml)

cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain)" ] || { echo "The working tree has changes: commit or stash them first." >&2; exit 1; }

git fetch --quiet "$UPSTREAM" main
upstream=$(git rev-parse FETCH_HEAD)
if git merge-base --is-ancestor "$upstream" HEAD; then
  echo "Already up to date with books ${upstream:0:7}."
  exit 0
fi

# Conflicts are resolved below, so a conflicted merge isn't a failure yet
git merge --no-ff --no-commit "$upstream" >/dev/null 2>&1 || true

# The app's own paths go back to exactly what this app had: files upstream added there are removed,
# files it changed or deleted are restored, conflicts there are resolved to ours.
for path in "${OWN[@]}"; do
  if git cat-file -e "HEAD:$path" 2>/dev/null; then
    git restore --source=HEAD --staged --worktree -- "$path"
  elif [ -n "$(git ls-files -- "$path")" ]; then
    git rm -r -q -f -- "$path"
  fi
done

conflicts=$(git diff --name-only --diff-filter=U)
if [ -n "$conflicts" ]; then
  git merge --abort
  echo "Merging books ${upstream:0:7} conflicts with changes made here to engine files:" >&2
  echo "$conflicts" | sed 's/^/  /' >&2
  echo "Engine files only change in books (docs/editions.md). Undo those changes here, or make them in books." >&2
  exit 1
fi

git commit --quiet -m "Merge books ${upstream:0:7}" -m "Engine changes from https://github.com/freeappstore-online/books/commit/$upstream, by scripts/edition/sync-upstream.sh. This app's own files (${OWN[*]}) are unchanged."
echo "Merged books ${upstream:0:7}."
