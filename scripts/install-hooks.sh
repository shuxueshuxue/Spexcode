#!/usr/bin/env bash
# @@@ install-hooks - copy repo hooks into the common git hooks dir (shared across ALL
# worktrees, since hooks live in the common git dir). Run once: `npm run hooks`.
#
# Source = spec-cli/templates/hooks — the ONE canonical hook source, the same files `spex init` plants
# when a project adopts SpexCode. Both install paths ITERATE that dir (not a hardcoded file list), so a
# new hook template (e.g. post-merge) installs from both paths automatically and they can never drift.
set -euo pipefail
cd "$(dirname "$0")/.."
hooks_dir="$(git rev-parse --git-common-dir)/hooks"
src="spec-cli/templates/hooks"
mkdir -p "$hooks_dir"
for f in "$src"/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  install -m 0755 "$f" "$hooks_dir/$name"
  echo "✓ installed $name -> $hooks_dir/$name"
done
