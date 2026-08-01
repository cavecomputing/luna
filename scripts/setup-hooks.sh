#!/bin/sh
# Points git at the committed .githooks/ directory.
#
# Runs automatically via package.json "prepare" after every npm install.
# Run by hand with: npm run setup   (or: sh scripts/setup-hooks.sh)
#
# Needed once per clone, because core.hooksPath lives in .git/config,
# which is local to each machine and never committed.

set -e

# CI has no developer to protect and often has no .git directory.
if [ -n "$CI" ]; then
  echo "setup-hooks: CI detected — skipping"
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "setup-hooks: not a git repository — skipping"
  exit 0
fi

root=$(git rev-parse --show-toplevel)
cd "$root"

if [ ! -d .githooks ]; then
  echo "setup-hooks: .githooks/ not found — skipping"
  exit 0
fi

chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks

echo "setup-hooks: git hooks enabled from .githooks/"
