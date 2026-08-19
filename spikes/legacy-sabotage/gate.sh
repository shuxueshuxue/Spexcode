#!/usr/bin/env bash
set -uo pipefail

repo_root=${LEGACY_GATE_REPO_ROOT:-$(git rev-parse --show-toplevel)}
repo_root=$(realpath "$repo_root")
scratch=$(mktemp -d /tmp/spex-legacy-gate.XXXXXX)
trap 'rm -rf "$scratch"' EXIT

# One vocabulary drives source, dist, tarball, materialized-copy and runtime checks. Test
# files preserve attack evidence but are not production consumers.
legacy_static_pattern='session\.json|pending\.json|timeline\.ndjson|cursors\.json|watchers\.json|\.delivery-locks|\.session-locks|\.revoked-senders|SPEXCODE_TIMELINE_SEGMENT_BYTES|@spexcode/session-core(/internal)?|runtime-session(\.js)?|delivery-queue(\.js)?|session-timeline(\.js)?|session-cursors(\.js)?|record-lock(\.js)?|spexcode-rv-|runtimeRoot\([^)]*\).*hooks-manifest|runtime_root.*hooks-manifest'
legacy_runtime_pattern='/sessions/[^" ]+/(session\.json|pending\.json|timeline\.ndjson|timeline/[^" ]+\.ndjson|cursors\.json|watchers\.json)|/(\.delivery-locks|\.session-locks|\.revoked-senders)/|/tmp/spexcode-rv-[^" ]+\.sock|/hooks-manifest'

all_static="$scratch/static-all.txt"
production_static="$scratch/static-production.txt"
test_static="$scratch/static-test.txt"
static_prerequisite=MEASURED
static_reasons=()
for required in package.json package-lock.json packages spec-cli scripts; do
  if [[ ! -e "$repo_root/$required" ]]; then
    static_prerequisite=NOT-MEASURED
    static_reasons+=("missing-source-root:$required")
  fi
done

(
  cd "$repo_root"
  rg -n --no-heading -e "$legacy_static_pattern" \
    package.json package-lock.json packages spec-cli scripts \
    -g '*.{ts,tsx,js,mjs,cjs,sh,json}' \
    -g '!**/dist/**' -g '!**/node_modules/**' 2>/dev/null || true
) | LC_ALL=C sort -u > "$all_static"

awk -F: '
  $1 ~ /(^|\/)(test|tests|fixtures|compat)\// || $1 ~ /\.test\./ || $1 ~ /\.fixture$/ { print; next }
  { print > production }
' production="$production_static" "$all_static" > "$test_static"
touch "$production_static" "$test_static"
if [[ "$static_prerequisite" == MEASURED ]]; then
  static_legacy_imports=$(wc -l < "$production_static" | tr -d ' ')
else
  static_legacy_imports=NOT-MEASURED
fi
test_only_legacy_evidence=$(wc -l < "$test_static" | tr -d ' ')

dist_hits="$scratch/dist-hits.txt"
tarball_hits="$scratch/tarball-hits.txt"
materialized_hits="$scratch/materialized-hits.txt"
: > "$dist_hits"
: > "$tarball_hits"
: > "$materialized_hits"

scan_tree() {
  local root=$1 label=$2 output=$3
  [[ -d "$root" ]] || return 0
  while IFS= read -r -d '' file; do
    if rg -q -e "$legacy_static_pattern" "$file" 2>/dev/null; then
      printf '%s::%s\n' "$label" "${file#"$root"/}" >> "$output"
    fi
  done < <(find "$root" -type f -print0)
}

# dist is measured only against an explicit disposable root after the root clean build.
dist_prerequisite=MEASURED
dist_reasons=()
build_root=${LEGACY_GATE_BUILD_ROOT:-}
expected_build_entries=(
  packages/spec-core/dist/index.js
  packages/session-core/dist/index.js
  spec-cli/dist/cli.js
  spec-eval/dist/index.js
  spec-forge/dist/index.js
)
if [[ -z "$build_root" ]]; then
  dist_prerequisite=NOT-MEASURED
  dist_reasons+=(missing-clean-build-root)
elif [[ ! -d "$build_root" ]]; then
  dist_prerequisite=NOT-MEASURED
  dist_reasons+=(invalid-clean-build-root)
else
  for entry in "${expected_build_entries[@]}"; do
    if [[ ! -f "$build_root/$entry" ]]; then
      dist_prerequisite=NOT-MEASURED
      dist_reasons+=("missing-clean-build-entry:$entry")
    fi
  done
  while IFS= read -r -d '' dist_dir; do
    scan_tree "$dist_dir" "dist:${dist_dir#"$build_root"/}" "$dist_hits"
  done < <(find "$build_root" -type d -name dist -not -path '*/node_modules/*' -print0)
fi
LC_ALL=C sort -u -o "$dist_hits" "$dist_hits"
if [[ "$dist_prerequisite" == MEASURED ]]; then
  legacy_dist_files=$(wc -l < "$dist_hits" | tr -d ' ')
else
  legacy_dist_files=NOT-MEASURED
fi

# Packed artifacts are independent of the build tree. At least one explicit npm-pack tarball must unpack.
tarball_prerequisite=MEASURED
tarball_reasons=()
if [[ -n ${LEGACY_GATE_TARBALLS:-} ]]; then
  IFS=: read -r -a tarballs <<< "$LEGACY_GATE_TARBALLS"
  tar_index=0
  for tarball in "${tarballs[@]}"; do
    tar_index=$((tar_index + 1))
    tar_root="$scratch/tar-$tar_index"
    mkdir -p "$tar_root"
    if [[ ! -f "$tarball" ]]; then
      tarball_prerequisite=NOT-MEASURED
      tarball_reasons+=("missing-tarball:$tarball")
      continue
    fi
    if ! tar -xzf "$tarball" -C "$tar_root" 2> "$scratch/tar-$tar_index.stderr"; then
      tarball_prerequisite=NOT-MEASURED
      tarball_reasons+=("invalid-tarball:$tarball")
      continue
    fi
    if [[ ! -f "$tar_root/package/package.json" ]]; then
      tarball_prerequisite=NOT-MEASURED
      tarball_reasons+=("invalid-npm-pack-layout:$tarball")
      continue
    fi
    scan_tree "$tar_root" "tarball:$tarball" "$tarball_hits"
  done
else
  tarball_prerequisite=NOT-MEASURED
  tarball_reasons+=(missing-npm-pack-tarballs)
fi
LC_ALL=C sort -u -o "$tarball_hits" "$tarball_hits"
if [[ "$tarball_prerequisite" == MEASURED ]]; then
  legacy_tarball_files=$(wc -l < "$tarball_hits" | tr -d ' ')
else
  legacy_tarball_files=NOT-MEASURED
fi

# Materialized output must be explicitly named after re-materialization. Prose skills/commands
# are evidence/configuration; executable hooks/plugins/settings are the generated runtime surface.
materialized_prerequisite=MEASURED
materialized_reasons=()
materialized_files=0
if [[ -n ${LEGACY_GATE_MATERIALIZED_ROOTS:-} ]]; then
  IFS=: read -r -a materialized_roots <<< "$LEGACY_GATE_MATERIALIZED_ROOTS"
  for root in "${materialized_roots[@]}"; do
    if [[ ! -d "$root" ]]; then
      materialized_prerequisite=NOT-MEASURED
      materialized_reasons+=("invalid-materialized-root:$root")
      continue
    fi
    while IFS= read -r -d '' file; do
      case "$file" in
        */skills/*|*/commands/*) continue ;;
        *.js|*.mjs|*.cjs|*.ts|*.sh|*.json)
          materialized_files=$((materialized_files + 1))
          if rg -q -e "$legacy_static_pattern" "$file" 2>/dev/null; then
            printf 'materialized:%s\n' "$file" >> "$materialized_hits"
          fi
          ;;
      esac
    done < <(find "$root" -type f -print0)
  done
else
  materialized_prerequisite=NOT-MEASURED
  materialized_reasons+=(missing-materialized-roots)
fi
if (( materialized_files == 0 )); then
  materialized_prerequisite=NOT-MEASURED
  materialized_reasons+=(no-materialized-executables)
fi
LC_ALL=C sort -u -o "$materialized_hits" "$materialized_hits"
if [[ "$materialized_prerequisite" == MEASURED ]]; then
  legacy_materialized_files=$(wc -l < "$materialized_hits" | tr -d ' ')
else
  legacy_materialized_files=NOT-MEASURED
fi

if [[ ${1:-} == -- ]]; then
  shift
  if [[ $# -eq 0 ]]; then
    printf 'usage: %s [-- command arg ...]\n' "$0" >&2
    exit 2
  fi
  trace_command=("$@")
else
  trace_command=(env SPEXCODE_API_URL= spex session ls --json)
fi

raw_trace="$scratch/runtime.strace"
trace_stdout="$scratch/runtime.stdout"
trace_stderr="$scratch/runtime.stderr"
runtime_hits="$scratch/runtime-legacy.txt"
runtime_prerequisite=MEASURED
runtime_reasons=()
trace_status=NOT-RUN
if [[ ! -x /usr/bin/strace ]]; then
  runtime_prerequisite=NOT-MEASURED
  runtime_reasons+=(missing-/usr/bin/strace)
  : > "$runtime_hits"
else
  (
    cd "$repo_root"
    /usr/bin/strace -f -qq -e trace=%file -s 4096 -o "$raw_trace" -- \
      "${trace_command[@]}" > "$trace_stdout" 2> "$trace_stderr"
  )
  trace_status=$?
  rg -e "$legacy_runtime_pattern" "$raw_trace" > "$runtime_hits" || true
  if (( trace_status != 0 )); then
    runtime_prerequisite=NOT-MEASURED
    runtime_reasons+=("traced-command-exit:$trace_status")
  fi
fi
if [[ "$runtime_prerequisite" == MEASURED ]]; then
  runtime_legacy_reads=$(wc -l < "$runtime_hits" | tr -d ' ')
else
  runtime_legacy_reads=NOT-MEASURED
fi

join_reasons() {
  local -n reasons=$1
  if (( ${#reasons[@]} == 0 )); then printf 'none'; else (IFS=,; printf '%s' "${reasons[*]}"); fi
}

printf 'legacy deletion gate\n'
printf 'repo=%s\n' "$repo_root"
printf 'trace_command='
printf '%q ' "${trace_command[@]}"
printf '\n'
printf 'trace_exit=%s\n' "$trace_status"
printf 'test_only_legacy_evidence=%s (reported, excluded from static_legacy_imports)\n' "$test_only_legacy_evidence"
printf 'static_legacy_imports_prerequisite=%s(%s)\n' "$static_prerequisite" "$(join_reasons static_reasons)"
printf 'legacy_dist_files_prerequisite=%s(%s)\n' "$dist_prerequisite" "$(join_reasons dist_reasons)"
printf 'legacy_tarball_files_prerequisite=%s(%s)\n' "$tarball_prerequisite" "$(join_reasons tarball_reasons)"
printf 'legacy_materialized_files_prerequisite=%s(%s)\n' "$materialized_prerequisite" "$(join_reasons materialized_reasons)"
printf 'runtime_legacy_reads_prerequisite=%s(%s)\n' "$runtime_prerequisite" "$(join_reasons runtime_reasons)"

if [[ -s "$production_static" ]]; then
  printf '%s\n' '--- production source legacy references ---'
  sed 's/^/static: /' "$production_static"
fi
if [[ -s "$dist_hits" ]]; then
  printf '%s\n' '--- dist legacy files ---'
  sed 's/^/dist: /' "$dist_hits"
fi
if [[ -s "$tarball_hits" ]]; then
  printf '%s\n' '--- tarball legacy files ---'
  sed 's/^/tarball: /' "$tarball_hits"
fi
if [[ -s "$materialized_hits" ]]; then
  printf '%s\n' '--- materialized legacy files ---'
  sed 's/^/materialized: /' "$materialized_hits"
fi
if [[ -s "$runtime_hits" ]]; then
  printf '%s\n' '--- runtime legacy file accesses ---'
  sed 's/^/runtime: /' "$runtime_hits"
fi
if [[ -s ${trace_stderr:-/nonexistent} ]]; then
  printf '%s\n' '--- traced command stderr ---'
  sed 's/^/trace-stderr: /' "$trace_stderr"
fi

printf 'static_legacy_imports=%s\n' "$static_legacy_imports"
printf 'legacy_dist_files=%s\n' "$legacy_dist_files"
printf 'legacy_tarball_files=%s\n' "$legacy_tarball_files"
printf 'legacy_materialized_files=%s\n' "$legacy_materialized_files"
printf 'runtime_legacy_reads=%s\n' "$runtime_legacy_reads"

if [[ "$static_prerequisite" != MEASURED || "$dist_prerequisite" != MEASURED \
  || "$tarball_prerequisite" != MEASURED || "$materialized_prerequisite" != MEASURED \
  || "$runtime_prerequisite" != MEASURED ]]; then
  printf 'legacy gate: NOT-MEASURED (every prerequisite must be satisfied)\n' >&2
  exit 2
fi
if (( static_legacy_imports != 0 || legacy_dist_files != 0 || legacy_tarball_files != 0 \
  || legacy_materialized_files != 0 || runtime_legacy_reads != 0 )); then
  printf 'legacy gate: FAIL (all measured legacy counts must be zero)\n' >&2
  exit 1
fi
printf 'legacy gate: PASS\n'
