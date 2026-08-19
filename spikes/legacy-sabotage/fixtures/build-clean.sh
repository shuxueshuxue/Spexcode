#!/usr/bin/env bash
set -euo pipefail

root=$(realpath "${1:?fixture root is required}")
for dist_dir in \
  packages/spec-core/dist \
  packages/session-core/dist \
  spec-cli/dist \
  spec-eval/dist \
  spec-forge/dist; do
  if [[ -e "$root/$dist_dir" ]]; then
    printf 'clean-build fixture already contains %s\n' "$dist_dir" >&2
    exit 2
  fi
done
for entry in \
  packages/spec-core/dist/index.js \
  packages/session-core/dist/index.js \
  spec-cli/dist/cli.js \
  spec-eval/dist/index.js \
  spec-forge/dist/index.js; do
  mkdir -p "$root/$(dirname "$entry")"
  cp "$root/clean-source.js" "$root/$entry"
done
