#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
gate="$repo_root/spikes/legacy-sabotage/gate.sh"
node_bin=/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64/bin/node
npm_bin=/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64/bin/npm
integration_head=6ea863b22
evidence_dir=${1:-}

if [[ -z "$evidence_dir" ]]; then
  printf 'usage: %s <new-evidence-directory>\n' "$0" >&2
  exit 2
fi
if [[ -e "$evidence_dir" ]]; then
  printf 'built baseline: refusing to overwrite evidence directory %s\n' "$evidence_dir" >&2
  exit 2
fi
mkdir -p "$evidence_dir"
evidence_dir=$(realpath "$evidence_dir")

scratch=$(mktemp -d /tmp/spex-legacy-built-baseline.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
built_root="$scratch/repo"
pack_root="$scratch/packs"
runtime_home="$scratch/home"
mkdir -p "$pack_root" "$runtime_home"

git clone --quiet --no-hardlinks "$repo_root" "$built_root" \
  > "$evidence_dir/clone.stdout" 2> "$evidence_dir/clone.stderr"
git -C "$built_root" checkout --quiet --detach "$integration_head" \
  > "$evidence_dir/checkout.stdout" 2> "$evidence_dir/checkout.stderr"
git -C "$built_root" rev-parse HEAD > "$evidence_dir/integration-head.txt"

env -C "$built_root" "$npm_bin" ci \
  > "$evidence_dir/npm-ci.stdout" 2> "$evidence_dir/npm-ci.stderr"
env -C "$built_root" "$npm_bin" run build \
  > "$evidence_dir/build.stdout" 2> "$evidence_dir/build.stderr"

publish_workspaces=(spec-core session-core spec-eval spec-forge spec-cli)
for workspace in "${publish_workspaces[@]}"; do
  env -C "$built_root" "$npm_bin" pack --silent --workspace="@spexcode/$workspace" \
    --pack-destination "$pack_root" \
    > "$evidence_dir/pack-$workspace.stdout" 2> "$evidence_dir/pack-$workspace.stderr"
done

env -C "$built_root" SPEXCODE_HOME="$runtime_home" \
  "$node_bin" "$built_root/bin/spex.mjs" materialize \
  > "$evidence_dir/materialize.stdout" 2> "$evidence_dir/materialize.stderr"

tarballs=()
while IFS= read -r -d '' item; do tarballs+=("$item"); done \
  < <(find "$pack_root" -maxdepth 1 -type f -name '*.tgz' -print0 | LC_ALL=C sort -z)
if (( ${#tarballs[@]} != ${#publish_workspaces[@]} )); then
  printf 'built baseline: expected %s npm-pack tarballs, found %s\n' \
    "${#publish_workspaces[@]}" "${#tarballs[@]}" >&2
  exit 2
fi
materialized_roots=()
for root in .codex .claude .opencode .pi; do
  [[ -d "$built_root/$root" ]] && materialized_roots+=("$built_root/$root")
done
if (( ${#materialized_roots[@]} == 0 )); then
  printf 'built baseline: materialize produced no harness root\n' >&2
  exit 2
fi

join_colon() { local IFS=:; printf '%s' "$*"; }
tarball_arg=$(join_colon "${tarballs[@]}")
materialized_arg=$(join_colon "${materialized_roots[@]}")
printf '%q ' env -C "$built_root" SPEXCODE_API_URL= \
  LEGACY_GATE_BUILD_ROOT="$built_root" \
  LEGACY_GATE_TARBALLS="$tarball_arg" \
  LEGACY_GATE_MATERIALIZED_ROOTS="$materialized_arg" \
  "$gate" -- "$node_bin" "$built_root/bin/spex.mjs" session ls --json \
  > "$evidence_dir/gate.command"
printf '\n' >> "$evidence_dir/gate.command"

set +e
env -C "$built_root" SPEXCODE_API_URL= \
  LEGACY_GATE_BUILD_ROOT="$built_root" \
  LEGACY_GATE_TARBALLS="$tarball_arg" \
  LEGACY_GATE_MATERIALIZED_ROOTS="$materialized_arg" \
  "$gate" -- "$node_bin" "$built_root/bin/spex.mjs" session ls --json \
  > "$evidence_dir/gate.stdout" 2> "$evidence_dir/gate.stderr"
status=$?
set -e
printf '%s\n' "$status" > "$evidence_dir/gate.exit"
exit "$status"
