#!/usr/bin/env bash
# @@@ install-hooks - copy repo hooks into the common git hooks dir (shared across ALL
# worktrees, since hooks live in the common git dir). Run once: `npm run hooks`.
set -euo pipefail
cd "$(dirname "$0")/.."
hooks_dir="$(git rev-parse --git-common-dir)/hooks"
mkdir -p "$hooks_dir"
install -m 0755 scripts/hooks/pre-commit "$hooks_dir/pre-commit"
echo "✓ installed main-guard pre-commit -> $hooks_dir/pre-commit"
install -m 0755 scripts/hooks/prepare-commit-msg "$hooks_dir/prepare-commit-msg"
echo "✓ installed session-stamp prepare-commit-msg -> $hooks_dir/prepare-commit-msg"
