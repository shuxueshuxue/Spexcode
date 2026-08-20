#!/usr/bin/env bash
set -euo pipefail

target=${1:?materialized root is required}
mkdir -p "$target"
printf '{"hooks":[]}\n' > "$target/hooks.json"
