#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
gate="$repo_root/spikes/legacy-sabotage/gate.sh"
fixtures="$repo_root/spikes/legacy-sabotage/fixtures"
node_bin=${LEGACY_GATE_NODE_BIN:-/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64/bin/node}
npm_bin=${LEGACY_GATE_NPM_BIN:-/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64/bin/npm}
evidence_dir=${1:-}

if [[ -z "$evidence_dir" ]]; then
  printf 'usage: %s <new-evidence-directory>\n' "$0" >&2
  exit 2
fi
if [[ -e "$evidence_dir" ]]; then
  printf 'legacy gate self-test: refusing to overwrite evidence directory %s\n' "$evidence_dir" >&2
  exit 2
fi
if [[ ! -x "$node_bin" ]]; then
  printf 'legacy gate self-test: required node binary is absent: %s\n' "$node_bin" >&2
  exit 2
fi
if [[ ! -x "$npm_bin" ]]; then
  printf 'legacy gate self-test: required npm binary is absent: %s\n' "$npm_bin" >&2
  exit 2
fi

mkdir -p "$evidence_dir"
evidence_dir=$(realpath "$evidence_dir")
scratch=$(mktemp -d /tmp/spex-legacy-gate-self-test.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

make_repo() {
  local root=$1
  mkdir -p \
    "$root/packages/spec-core/src" \
    "$root/packages/session-core/src" \
    "$root/spec-cli/src" \
    "$root/spec-eval/src" "$root/spec-forge/src" \
    "$root/scripts" "$root/pack-src/dist"
  printf '{"scripts":{"build":"bash build-clean.sh ."}}\n' > "$root/package.json"
  printf '{}\n' > "$root/package-lock.json"
  printf 'export {}\n' > "$root/clean-source.js"
  printf '{"name":"legacy-gate-clean","version":"1.0.0","files":["dist"]}\n' \
    > "$root/pack-src/package.json"
  cp "$root/clean-source.js" "$root/pack-src/dist/index.js"
  cp "$fixtures/build-clean.sh" "$root/build-clean.sh"
  cp "$fixtures/materialize-clean.sh" "$root/materialize-clean.sh"
  env -C "$root" "$npm_bin" run build --silent
  env -C "$root/pack-src" "$npm_bin" pack --silent --pack-destination "$root" > /dev/null
  bash "$root/materialize-clean.sh" "$root/.codex"
}

run_gate() {
  local label=$1 root=$2
  shift 2
  printf '%q ' env -C "$root" SPEXCODE_API_URL= \
    LEGACY_GATE_REPO_ROOT="$root" \
    LEGACY_GATE_BUILD_ROOT="$root" \
    LEGACY_GATE_TARBALLS="$root/legacy-gate-clean-1.0.0.tgz" \
    LEGACY_GATE_MATERIALIZED_ROOTS="$root/.codex" \
    "$gate" -- "$@" > "$evidence_dir/$label.command"
  printf '\n' >> "$evidence_dir/$label.command"
  set +e
  env -C "$root" SPEXCODE_API_URL= \
    LEGACY_GATE_REPO_ROOT="$root" \
    LEGACY_GATE_BUILD_ROOT="$root" \
    LEGACY_GATE_TARBALLS="$root/legacy-gate-clean-1.0.0.tgz" \
    LEGACY_GATE_MATERIALIZED_ROOTS="$root/.codex" \
    "$gate" -- "$@" > "$evidence_dir/$label.stdout" 2> "$evidence_dir/$label.stderr"
  local status=$?
  set -e
  printf '%s\n' "$status" > "$evidence_dir/$label.exit"
}

clean="$scratch/clean"
make_repo "$clean"
run_gate clean "$clean" /bin/true

static="$scratch/static"
cp -a "$clean" "$static"
cp "$fixtures/static-legacy-consumer.ts" "$static/spec-cli/src/consumer.ts"
run_gate static-fail "$static" /bin/true

generated="$scratch/generated"
cp -a "$clean" "$generated"
cp "$fixtures/generated-hook.sh" "$generated/spec-cli/dist/legacy-hook.sh"
run_gate generated-fail "$generated" /bin/true

tarball="$scratch/tarball"
cp -a "$clean" "$tarball"
tarball_mutation="$scratch/tarball-mutation"
mkdir -p "$tarball_mutation"
tar -xzf "$tarball/legacy-gate-clean-1.0.0.tgz" -C "$tarball_mutation"
cp "$fixtures/generated-hook.sh" "$tarball_mutation/package/dist/legacy-hook.sh"
tar -czf "$tarball/legacy-gate-clean-1.0.0.tgz" -C "$tarball_mutation" package
run_gate tarball-fail "$tarball" /bin/true

materialized="$scratch/materialized"
cp -a "$clean" "$materialized"
cp "$fixtures/generated-hook.sh" "$materialized/.codex/legacy-hook.sh"
run_gate materialized-fail "$materialized" /bin/true

runtime="$scratch/runtime"
cp -a "$clean" "$runtime"
legacy_runtime_path="$runtime/store/sessions/self/session.json"
mkdir -p "$(dirname "$legacy_runtime_path")"
printf '{}\n' > "$legacy_runtime_path"
run_gate runtime-fail "$runtime" env LEGACY_FIXTURE_PATH="$legacy_runtime_path" \
  "$node_bin" "$fixtures/runtime-legacy-read.mjs" "$legacy_runtime_path"

clean_exit=$(<"$evidence_dir/clean.exit")
static_exit=$(<"$evidence_dir/static-fail.exit")
generated_exit=$(<"$evidence_dir/generated-fail.exit")
tarball_exit=$(<"$evidence_dir/tarball-fail.exit")
materialized_exit=$(<"$evidence_dir/materialized-fail.exit")
runtime_exit=$(<"$evidence_dir/runtime-fail.exit")

[[ "$clean_exit" == 0 ]]
rg -q '^static_legacy_imports_prerequisite=MEASURED\(none\)$' "$evidence_dir/clean.stdout"
rg -q '^legacy_dist_files_prerequisite=MEASURED\(none\)$' "$evidence_dir/clean.stdout"
rg -q '^legacy_tarball_files_prerequisite=MEASURED\(none\)$' "$evidence_dir/clean.stdout"
rg -q '^legacy_materialized_files_prerequisite=MEASURED\(none\)$' "$evidence_dir/clean.stdout"
rg -q '^runtime_legacy_reads_prerequisite=MEASURED\(none\)$' "$evidence_dir/clean.stdout"
rg -q '^static_legacy_imports=0$' "$evidence_dir/clean.stdout"
rg -q '^legacy_dist_files=0$' "$evidence_dir/clean.stdout"
rg -q '^legacy_tarball_files=0$' "$evidence_dir/clean.stdout"
rg -q '^legacy_materialized_files=0$' "$evidence_dir/clean.stdout"
rg -q '^runtime_legacy_reads=0$' "$evidence_dir/clean.stdout"
rg -q '^legacy gate: PASS$' "$evidence_dir/clean.stdout"
[[ "$static_exit" == 1 ]]
rg -q '^static_legacy_imports=1$' "$evidence_dir/static-fail.stdout"
rg -q '^legacy_dist_files=0$' "$evidence_dir/static-fail.stdout"
rg -q '^legacy_tarball_files=0$' "$evidence_dir/static-fail.stdout"
rg -q '^legacy_materialized_files=0$' "$evidence_dir/static-fail.stdout"
rg -q '^runtime_legacy_reads=0$' "$evidence_dir/static-fail.stdout"
rg -q '^legacy gate: FAIL \(all measured legacy counts must be zero\)$' "$evidence_dir/static-fail.stderr"
[[ "$generated_exit" == 1 ]]
rg -q '^legacy_dist_files=1$' "$evidence_dir/generated-fail.stdout"
rg -q '^legacy_tarball_files=0$' "$evidence_dir/generated-fail.stdout"
rg -q '^legacy_materialized_files=0$' "$evidence_dir/generated-fail.stdout"
rg -q '^legacy gate: FAIL \(all measured legacy counts must be zero\)$' "$evidence_dir/generated-fail.stderr"
[[ "$tarball_exit" == 1 ]]
rg -q '^legacy_dist_files=0$' "$evidence_dir/tarball-fail.stdout"
rg -q '^legacy_tarball_files=1$' "$evidence_dir/tarball-fail.stdout"
rg -q '^legacy_materialized_files=0$' "$evidence_dir/tarball-fail.stdout"
rg -q '^legacy gate: FAIL \(all measured legacy counts must be zero\)$' "$evidence_dir/tarball-fail.stderr"
[[ "$materialized_exit" == 1 ]]
rg -q '^legacy_dist_files=0$' "$evidence_dir/materialized-fail.stdout"
rg -q '^legacy_tarball_files=0$' "$evidence_dir/materialized-fail.stdout"
rg -q '^legacy_materialized_files=1$' "$evidence_dir/materialized-fail.stdout"
rg -q '^legacy gate: FAIL \(all measured legacy counts must be zero\)$' "$evidence_dir/materialized-fail.stderr"
[[ "$runtime_exit" == 1 ]]
rg -q '^legacy_dist_files=0$' "$evidence_dir/runtime-fail.stdout"
rg -q '^legacy_tarball_files=0$' "$evidence_dir/runtime-fail.stdout"
rg -q '^legacy_materialized_files=0$' "$evidence_dir/runtime-fail.stdout"
rg -q '^runtime_legacy_reads=[1-9][0-9]*$' "$evidence_dir/runtime-fail.stdout"
rg -q '^legacy gate: FAIL \(all measured legacy counts must be zero\)$' "$evidence_dir/runtime-fail.stderr"

printf 'legacy gate self-test: PASS (clean accepted; static/dist/tarball/materialized/runtime mutations rejected)\n'
