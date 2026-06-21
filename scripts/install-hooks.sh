#!/usr/bin/env bash
# @@@ install-hooks - copy repo hooks into the common git hooks dir (shared across ALL
# worktrees, since hooks live in the common git dir). Run once: `npm run hooks`.
#
# Source = spec-cli/templates/hooks — the ONE canonical hook source, the same files `spex init` plants
# when a project adopts SpexCode. Both install paths read it so they can never drift apart.
set -euo pipefail
cd "$(dirname "$0")/.."
hooks_dir="$(git rev-parse --git-common-dir)/hooks"
src="spec-cli/templates/hooks"
mkdir -p "$hooks_dir"
install -m 0755 "$src/pre-commit" "$hooks_dir/pre-commit"
echo "✓ installed main-guard pre-commit -> $hooks_dir/pre-commit"
install -m 0755 "$src/prepare-commit-msg" "$hooks_dir/prepare-commit-msg"
echo "✓ installed session-stamp prepare-commit-msg -> $hooks_dir/prepare-commit-msg"
