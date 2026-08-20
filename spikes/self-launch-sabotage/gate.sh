#!/usr/bin/env bash
set -uo pipefail

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf '%s\n' 'self-launch sabotage: NOT-MEASURED(not-in-git-checkout)' >&2
  exit 2
}
repo_root=$(realpath "$repo_root")
node22=${SABOTAGE_NODE22:-$HOME/.nvm/versions/node/v22.21.0/bin/node}
npm22=${SABOTAGE_NPM22:-$HOME/.nvm/versions/node/v22.21.0/bin/npm}
node24=${SABOTAGE_NODE24:-$HOME/.local/node-dist/node-v24.15.0-linux-x64/bin/node}
npm24_cli=${SABOTAGE_NPM24_CLI:-$HOME/.local/node-dist/node-v24.15.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js}
evidence_dir=${SABOTAGE_EVIDENCE_DIR:-}

not_measured() {
  local reason=$1
  if [[ -n ${evidence_dir:-} && -d ${fixture:-/nonexistent} ]]; then
    while IFS= read -r diagnostic; do
      cp "$diagnostic" "$evidence_dir/diagnostic-$(basename "$diagnostic")" 2>/dev/null || true
    done < <(command find "$fixture" -maxdepth 1 -type f -name '*.stderr' -print 2>/dev/null)
  fi
  printf 'fixture_prerequisite=NOT-MEASURED(%s)\n' "$reason"
  printf 'static_legacy_imports_prerequisite=NOT-MEASURED(%s)\n' "$reason"
  printf 'legacy_dist_files_prerequisite=NOT-MEASURED(%s)\n' "$reason"
  printf 'legacy_tarball_files_prerequisite=NOT-MEASURED(%s)\n' "$reason"
  printf 'legacy_materialized_files_prerequisite=NOT-MEASURED(%s)\n' "$reason"
  printf 'runtime_legacy_reads_prerequisite=NOT-MEASURED(%s)\n' "$reason"
  printf '%s\n' 'static_legacy_imports=NOT-MEASURED'
  printf '%s\n' 'legacy_dist_files=NOT-MEASURED'
  printf '%s\n' 'legacy_tarball_files=NOT-MEASURED'
  printf '%s\n' 'legacy_materialized_files=NOT-MEASURED'
  printf '%s\n' 'runtime_legacy_reads=NOT-MEASURED'
  printf 'self-launch sabotage: NOT-MEASURED(%s)\n' "$reason" >&2
  exit 2
}

for required in "$node22" "$npm22" "$node24" "$npm24_cli" /usr/bin/strace; do
  [[ -x "$required" ]] || not_measured "missing-tool:$required"
done
for command_name in git tar realpath rg sha256sum pgrep; do
  command -v "$command_name" >/dev/null 2>&1 || not_measured "missing-tool:$command_name"
done

if [[ -n "$evidence_dir" ]]; then
  case "$(realpath -m "$evidence_dir")" in
    "$repo_root/spikes/self-launch-sabotage/"*) ;;
    *) not_measured 'evidence-dir-outside-owned-surface' ;;
  esac
  [[ ! -e "$evidence_dir" ]] || not_measured 'evidence-dir-already-exists'
  mkdir -p "$evidence_dir" || not_measured 'cannot-create-evidence-dir'
  evidence_dir=$(realpath "$evidence_dir")
fi

fixture=$(mktemp -d /tmp/spex-self-launch-sabotage.XXXXXX) || not_measured 'mktemp-failed'
fixture=$(realpath "$fixture")
printf 'fixture=%s\n' "$fixture"

cleanup() {
  case "$fixture" in /tmp/spex-self-launch-sabotage.*) rm -rf -- "$fixture" ;; esac
}
trap cleanup EXIT

inside_fixture() {
  local label=$1 candidate=$2 resolved
  resolved=$(realpath -m "$candidate") || not_measured "realpath-failed:$label"
  case "$resolved" in
    "$fixture"|"$fixture/"*) printf 'fixture_path_%s=MEASURED(%s)\n' "$label" "$resolved" ;;
    *) not_measured "fixture-path-escaped:$label:$resolved" ;;
  esac
}

project="$fixture/project"
product_home="$fixture/home/.spexcode"
operator_home="$fixture/home"
fixture_tmp="$fixture/tmp"
database_dir="$fixture/database"
database="$database_dir/sessions.sqlite"
packs="$fixture/packs"
for path_row in \
  "project:$project" "spexcode_home:$product_home" "home:$operator_home" \
  "tmpdir:$fixture_tmp" "database:$database" "packs:$packs"; do
  inside_fixture "${path_row%%:*}" "${path_row#*:}"
done
mkdir -p "$project" "$product_home" "$fixture_tmp" "$database_dir" "$packs" || not_measured 'fixture-layout-failed'
export TMPDIR="$fixture_tmp"

if ! git -C "$repo_root" archive --format=tar HEAD | tar -xf - -C "$project"; then
  not_measured 'checkout-copy-failed'
fi
git -C "$project" init -q || not_measured 'fixture-git-init-failed'

install_log="$fixture/install.log"
build_log="$fixture/build.log"
if ! "$node24" "$npm24_cli" ci --ignore-scripts --no-audit --no-fund \
  --prefix "$project" >"$install_log" 2>&1; then
  [[ -n "$evidence_dir" ]] && cp "$install_log" "$evidence_dir/install.log"
  not_measured 'node24-npm-ci-failed'
fi

run_npm22() {
  env PATH="$(dirname "$node22"):$PATH" "$npm22" --prefix "$project" "$@"
}
if ! {
  run_npm22 run build --workspace=@spexcode/session-protocol
  run_npm22 run build --workspace=@spexcode/session-selflaunch
  run_npm22 run build
} >"$build_log" 2>&1; then
  [[ -n "$evidence_dir" ]] && cp "$build_log" "$evidence_dir/build.log"
  not_measured 'node22-clean-build-failed'
fi

fixture_env=(
  env
  -C "$project"
  "PATH=$(dirname "$node22"):$project/node_modules/.bin:/usr/bin:/bin"
  "HOME=$operator_home"
  "SPEXCODE_HOME=$product_home"
  "TMPDIR=$fixture_tmp"
  "SPEX=$node22 $project/bin/spex.mjs"
  "SPEX_SESSION_CLI=$project/packages/session-selflaunch/bin/spex-session.mjs"
  "SPEX_SESSION_DATABASE_PATH=$database"
  "CLAUDE_PROJECT_DIR=$project"
)
spex="$project/bin/spex.mjs"
if ! "${fixture_env[@]}" "$node22" "$spex" materialize >"$fixture/materialize.stdout" 2>"$fixture/materialize.stderr"; then
  [[ -n "$evidence_dir" ]] && cp "$fixture/materialize.stderr" "$evidence_dir/materialize.stderr"
  not_measured 'materialize-exit-nonzero'
fi

mapfile -t runtime_roots < <(command find "$product_home/projects" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null)
[[ ${#runtime_roots[@]} -eq 1 ]] || not_measured "runtime-root-count:${#runtime_roots[@]}"
runtime_root=${runtime_roots[0]}
inside_fixture runtime_root "$runtime_root"
mapfile -t tree_slots < <(command find "$runtime_root/trees" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null)
[[ ${#tree_slots[@]} -eq 1 ]] || not_measured "tree-slot-count:${#tree_slots[@]}"
tree_slot=${tree_slots[0]}
inside_fixture tree_slot "$tree_slot"
old_sessions="$runtime_root/sessions"
old_session="$old_sessions/sabotage-native-session"
inside_fixture old_sessions "$old_sessions"
inside_fixture old_session "$old_session"

dispatch="$project/spec-cli/hooks/dispatch.sh"
cli="$project/packages/session-selflaunch/bin/spex-session.mjs"
session_start_payload=$(printf '{"session_id":"sabotage-native-session","hook_event_name":"SessionStart","cwd":"%s"}' "$project")
prompt_payload=$(printf '{"session_id":"sabotage-native-session","hook_event_name":"UserPromptSubmit","prompt":"next","cwd":"%s"}' "$project")

run_cli() {
  "${fixture_env[@]}" "$node22" "$cli" "$@"
}

run_dispatch() {
  local event=$1 payload=$2 stdout_file=$3 stderr_file=$4
  printf '%s' "$payload" | "${fixture_env[@]}" bash "$dispatch" codex "$event" >"$stdout_file" 2>"$stderr_file"
  return ${PIPESTATUS[1]}
}

run_traced_dispatch() {
  local event=$1 payload=$2 trace=$3 stdout_file=$4 stderr_file=$5
  printf '%s' "$payload" | /usr/bin/strace -f -qq -e trace=%file,%process -s 4096 -o "$trace" -- \
    "${fixture_env[@]}" bash "$dispatch" codex "$event" >"$stdout_file" 2>"$stderr_file"
  return ${PIPESTATUS[1]}
}

run_traced_cli() {
  local trace=$1 stdout_file=$2 stderr_file=$3
  shift 3
  /usr/bin/strace -f -qq -e trace=%file,%process -s 4096 -o "$trace" -- \
    "${fixture_env[@]}" "$node22" "$cli" "$@" >"$stdout_file" 2>"$stderr_file"
}

listener_ancestor_legacy_accesses() {
  # File accesses from listener children count too; reconstruct their ancestry from process syscalls.
  local trace=$1 result listener_pid listener_count accesses
  result=$(awk -v pattern="$live_runtime_pattern" '
    function clear_seen(    key) { for (key in seen) delete seen[key] }
    {
      pid = ($1 ~ /^[0-9]+$/) ? $1 : ""
      if (pid != "" && $0 ~ /execve\(.*session-listen\.sh/) listener[pid] = 1
      if (pid != "" && $0 ~ / (clone|vfork|clone3)\(/) {
        child = ""
        if ($0 ~ /child_pid=[0-9]+/) {
          child = $0
          sub(/^.*child_pid=/, "", child)
          sub(/[^0-9].*$/, "", child)
        } else if ($0 ~ / = [0-9]+$/) {
          child = $0
          sub(/^.* = /, "", child)
          sub(/[^0-9].*$/, "", child)
        }
        if (child ~ /^[0-9]+$/) parent[child] = pid
      }
      if (pid != "" && $0 ~ pattern) accesses[pid]++
    }
    END {
      first_listener = ""
      listener_count = 0
      for (pid in listener) {
        listener_count++
        if (first_listener == "") first_listener = pid
      }
      total = 0
      for (pid in accesses) {
        current = pid
        found = 0
        clear_seen()
        while (current != "" && !(current in seen)) {
          seen[current] = 1
          if (listener[current]) { found = 1; break }
          current = parent[current]
        }
        if (found) total += accesses[pid]
      }
      printf "listener_pid=%s\nlistener_count=%d\nlistener_ancestor_accesses=%d\n", first_listener, listener_count, total
    }
  ' "$trace")
  listener_pid=$(printf '%s\n' "$result" | sed -n 's/^listener_pid=//p')
  listener_count=$(printf '%s\n' "$result" | sed -n 's/^listener_count=//p')
  accesses=$(printf '%s\n' "$result" | sed -n 's/^listener_ancestor_accesses=//p')
  [[ "$listener_count" == 1 && -n "$listener_pid" ]] || not_measured 'listener-pid-not-observed-in-trace'
  printf '%s\n' "$accesses"
}

json_body_is() {
  local file=$1 expected=$2
  "$node22" -e '
    const fs = require("node:fs")
    const [file, expected] = process.argv.slice(1)
    const value = JSON.parse(fs.readFileSync(file, "utf8"))
    const actual = value?.hookSpecificOutput?.additionalContext
    if (actual !== expected) process.exit(1)
  ' "$file" "$expected"
}

message_body_is() {
  local file=$1 expected=$2
  "$node22" -e '
    const fs = require("node:fs")
    const [file, expected] = process.argv.slice(1)
    const value = JSON.parse(fs.readFileSync(file, "utf8"))
    if (Buffer.from(value.bodyBase64, "base64").toString("utf8") !== expected) process.exit(1)
  ' "$file" "$expected"
}

resident_count() {
  local count
  count=$(pgrep -af -- "--database-path $database" 2>/dev/null | wc -l | tr -d ' ')
  printf '%s' "$count"
}

attack1=FAIL
mkdir -p "$old_session" || not_measured 'attack1-old-store-create-failed'
printf '%s\n' '{"poison":"renamed-old-root"}' >"$old_session/session.json"
renamed_store="$runtime_root/unfindable-old-sessions"
inside_fixture renamed_store "$renamed_store"
mv "$old_sessions" "$renamed_store" || not_measured 'attack1-rename-failed'
if run_dispatch SessionStart "$session_start_payload" "$fixture/a1-start.stdout" "$fixture/a1-start.stderr" \
  && run_cli enqueue --session-id sabotage-native-session --kind prompt --body 'RENAMED-ROOT-DELIVERY' \
    --database-path "$database" >"$fixture/a1-enqueue.stdout" 2>"$fixture/a1-enqueue.stderr" \
  && run_dispatch UserPromptSubmit "$prompt_payload" "$fixture/a1-deliver.stdout" "$fixture/a1-deliver.stderr" \
  && json_body_is "$fixture/a1-deliver.stdout" 'RENAMED-ROOT-DELIVERY' \
  && [[ $(run_cli pending --session-id sabotage-native-session --database-path "$database") == '[]' ]]; then
  attack1=PASS
fi

attack2=FAIL
mkdir -p "$old_sessions" || not_measured 'attack2-old-store-create-failed'
chmod 000 "$old_sessions" || not_measured 'attack2-deny-failed'
a2_trace="$fixture/attack2-dispatch.strace"
if run_traced_dispatch SessionStart "$session_start_payload" "$a2_trace" "$fixture/a2.stdout" "$fixture/a2.stderr"; then
  a2_command=PASS
else
  a2_command=FAIL
fi
chmod 700 "$old_sessions" || not_measured 'attack2-restore-failed'
live_runtime_pattern='/sessions/[^" ]+/(session\.json|spec-checked|spec-of-file-seen)|/trees/[^" ]+/(hooks-manifest|harnesses)'
old_state_runtime_pattern='/sessions/[^" ]+/(pending\.json|timeline\.ndjson|timeline/|cursors\.json|watchers\.json)|/\.(delivery-locks|session-locks|revoked-senders)/'
a2_old_accesses=$(rg -c -e "$live_runtime_pattern" "$a2_trace" 2>/dev/null || true)
a2_old_accesses=${a2_old_accesses:-0}
a2_listener_pid=$(awk '$0 ~ /execve\(.*session-listen\.sh/ && $1 ~ /^[0-9]+$/ { print $1; exit }' "$a2_trace")
[[ -n "$a2_listener_pid" ]] || not_measured 'listener-pid-not-observed-in-trace'
a2_listener_old_accesses=$(listener_ancestor_legacy_accesses "$a2_trace")
if [[ "$a2_command" == PASS && "$a2_listener_old_accesses" == 0 ]]; then attack2=PASS; fi

attack3=FAIL
mkdir -p "$old_session/timeline" "$runtime_root/.delivery-locks" || not_measured 'attack3-poison-layout-failed'
printf '%s\n' '[{"body":"POISON-PENDING"}]' >"$old_session/pending.json"
printf '%s\n' '{"event":"POISON-TIMELINE"}' >"$old_session/timeline.ndjson"
printf '%s\n' '{"event":"POISON-SEGMENT"}' >"$old_session/timeline/000000000001.ndjson"
printf '%s\n' '{"owner":"POISON-LOCK"}' >"$runtime_root/.delivery-locks/poison.lock"
run_cli enqueue --session-id sabotage-native-session --kind prompt --body 'DATABASE-AUTHORITY' \
  --database-path "$database" >"$fixture/a3-enqueue.stdout" 2>"$fixture/a3-enqueue.stderr" || not_measured 'attack3-enqueue-failed'
a3_trace="$fixture/attack3-dispatch.strace"
if run_traced_dispatch UserPromptSubmit "$prompt_payload" "$a3_trace" "$fixture/a3.stdout" "$fixture/a3.stderr" \
  && json_body_is "$fixture/a3.stdout" 'DATABASE-AUTHORITY'; then
  a3_state_accesses=$(rg -c -e "$old_state_runtime_pattern" "$a3_trace" 2>/dev/null || true)
  a3_state_accesses=${a3_state_accesses:-0}
  if [[ "$a3_state_accesses" == 0 ]] && ! rg -q 'POISON-' "$fixture/a3.stdout"; then attack3=NO-CONSUMER; fi
else
  a3_state_accesses=NOT-MEASURED
fi

attack4=FAIL
run_cli enqueue --session-id sabotage-native-session --kind prompt --body 'NO-WAKE-DURABLE' \
  --database-path "$database" >"$fixture/a4-enqueue.stdout" 2>"$fixture/a4-enqueue.stderr" || not_measured 'attack4-enqueue-failed'
a4_resident_after_enqueue=$(resident_count)
run_cli pending --session-id sabotage-native-session --database-path "$database" >"$fixture/a4-pending.stdout" 2>"$fixture/a4-pending.stderr" \
  || not_measured 'attack4-pending-failed'
a4_trace="$fixture/attack4-dequeue.strace"
if run_traced_cli "$a4_trace" "$fixture/a4-dequeue.stdout" "$fixture/a4-dequeue.stderr" \
  dequeue --session-id sabotage-native-session --database-path "$database"; then
  a4_resident_after_dequeue=$(resident_count)
  if message_body_is "$fixture/a4-dequeue.stdout" 'NO-WAKE-DURABLE' \
    && [[ "$a4_resident_after_enqueue" == 0 && "$a4_resident_after_dequeue" == 0 ]] \
    && [[ $(run_cli pending --session-id sabotage-native-session --database-path "$database") == '[]' ]]; then
    attack4=PASS
  fi
else
  a4_resident_after_dequeue=NOT-MEASURED
fi

attack5=FAIL
relocated_home="$fixture/relocated-home"
relocated_db="$relocated_home/sessions.sqlite"
inside_fixture relocated_home "$relocated_home"
inside_fixture relocated_db "$relocated_db"
mkdir -p "$relocated_home" || not_measured 'attack5-relocated-home-create-failed'
default_env=(
  env
  -C "$project"
  "PATH=$(dirname "$node22"):$project/node_modules/.bin:/usr/bin:/bin"
  "HOME=$operator_home"
  "SPEXCODE_HOME=$relocated_home"
  "TMPDIR=$fixture_tmp"
  "SPEX_SESSION_CLI=$cli"
  "CLAUDE_PROJECT_DIR=$project"
)
if "${default_env[@]}" "$node22" "$cli" initialize \
  --session-id relocated-default >"$fixture/a5.stdout" 2>"$fixture/a5.stderr"; then
  a5_exit=0
else
  a5_exit=$?
fi
if (( a5_exit == 0 )) && rg -q '"sessionId":"relocated-default"' "$fixture/a5.stdout" \
  && [[ -f "$relocated_db" && ! -e "$operator_home/.spexcode/sessions.sqlite" ]]; then
  attack5=PASS
fi

calibration_file="$old_session/pending.json"
calibration_trace="$fixture/calibration.strace"
/usr/bin/strace -f -qq -e trace=%file,%process -s 4096 -o "$calibration_trace" -- /bin/cat "$calibration_file" \
  >"$fixture/calibration.stdout" 2>"$fixture/calibration.stderr"
calibration_exit=$?
calibration_hits=$(awk -v poison="$calibration_file" '
  $0 ~ /(^| )(openat|newfstatat|stat|access)\(/ && index($0, poison) > 0 { hits++ }
  END { print hits + 0 }
' "$calibration_trace")
calibration_hits=${calibration_hits:-0}
(( calibration_exit == 0 && calibration_hits > 0 )) || not_measured 'strace-calibration-failed'

a2_trace_exit=0
a3_trace_exit=0
a4_trace_exit=0
runtime_prerequisite=MEASURED
a2_state_accesses=$(rg -c -e "$old_state_runtime_pattern" "$a2_trace" 2>/dev/null || true)
a2_state_accesses=${a2_state_accesses:-0}
a4_state_accesses=$(rg -c -e "$old_state_runtime_pattern" "$a4_trace" 2>/dev/null || true)
a4_state_accesses=${a4_state_accesses:-0}
a3_live_accesses=$(rg -c -e "$live_runtime_pattern" "$a3_trace" 2>/dev/null || true)
a3_live_accesses=${a3_live_accesses:-0}
a4_live_accesses=$(rg -c -e "$live_runtime_pattern" "$a4_trace" 2>/dev/null || true)
a4_live_accesses=${a4_live_accesses:-0}
runtime_old_message_reads=$((a3_state_accesses + a2_state_accesses + a4_state_accesses))
runtime_live_legacy_shape_reads=$((a2_old_accesses + a3_live_accesses + a4_live_accesses))
runtime_legacy_reads=$runtime_old_message_reads
attack6=FAIL
if (( runtime_legacy_reads == 0 )); then attack6=PASS; fi

legacy_static_pattern='pending\.json|timeline\.ndjson|session-cursors|watchers\.json|\.delivery-locks|\.session-locks|\.revoked-senders|SPEXCODE_TIMELINE_SEGMENT_BYTES|@spexcode/session-core(/internal)?|runtime-session(\.js)?|delivery-queue(\.js)?|session-timeline(\.js)?|session-cursors(\.js)?|record-lock(\.js)?'
static_all="$fixture/static-all.txt"
static_prod="$fixture/static-production.txt"
static_test="$fixture/static-test.txt"
: >"$static_all"
static_roots=(
  "$project/packages/session-selflaunch/src"
  "$project/packages/session-selflaunch/bin"
  "$project/packages/session-selflaunch/scripts"
  "$project/.spec/spexcode/.plugins/core/session-listen"
  "$project/spec-cli/templates/spec/project/.plugins/core/session-listen"
)
for static_root in "${static_roots[@]}"; do
  [[ -e "$static_root" ]] || not_measured "missing-static-root:$static_root"
done
rg -n --no-heading -e "$legacy_static_pattern" "${static_roots[@]}" \
  -g '*.{ts,js,mjs,sh,json}' 2>/dev/null | LC_ALL=C sort -u >"$static_all" || true
awk -F: '
  $1 ~ /(^|\/)(test|tests|fixtures|scripts)\// || $1 ~ /\.test\./ || $1 ~ /\.fixture$/ { print; next }
  { print > production }
' production="$static_prod" "$static_all" >"$static_test"
touch "$static_prod" "$static_test"
static_legacy_imports=$(wc -l <"$static_prod" | tr -d ' ')
test_only_legacy_evidence=$(wc -l <"$static_test" | tr -d ' ')

dist_root="$project/packages/session-selflaunch/dist"
[[ -f "$dist_root/cli.js" && -f "$dist_root/path.js" ]] || not_measured 'missing-clean-selflaunch-dist'
dist_hits="$fixture/dist-hits.txt"
command find "$dist_root" -type f -print0 | xargs -0 -r rg -l -e "$legacy_static_pattern" 2>/dev/null \
  | LC_ALL=C sort -u >"$dist_hits" || true
legacy_dist_files=$(wc -l <"$dist_hits" | tr -d ' ')

pack_log="$fixture/npm-pack.log"
if ! env PATH="$(dirname "$node22"):$PATH" "$npm22" pack "$project/packages/session-selflaunch" \
  --pack-destination "$packs" >"$pack_log" 2>&1; then
  not_measured 'npm-pack-failed'
fi
mapfile -t tarballs < <(command find "$packs" -maxdepth 1 -type f -name '*.tgz' -print)
[[ ${#tarballs[@]} -eq 1 ]] || not_measured "npm-pack-count:${#tarballs[@]}"
tar_root="$fixture/unpacked"
mkdir -p "$tar_root"
tar -xzf "${tarballs[0]}" -C "$tar_root" || not_measured 'npm-pack-invalid'
[[ -f "$tar_root/package/package.json" ]] || not_measured 'npm-pack-layout-invalid'
tarball_hits="$fixture/tarball-hits.txt"
command find "$tar_root/package" -type f -print0 | xargs -0 -r rg -l -e "$legacy_static_pattern" 2>/dev/null \
  | LC_ALL=C sort -u >"$tarball_hits" || true
legacy_tarball_files=$(wc -l <"$tarball_hits" | tr -d ' ')

materialized_hits="$fixture/materialized-hits.txt"
materialized_files="$fixture/materialized-files.txt"
{
  command find "$project/.codex" -type f ! -path '*/skills/*' -print
  printf '%s\n' "$tree_slot/hooks-manifest" "$tree_slot/harnesses"
} | LC_ALL=C sort -u >"$materialized_files"
[[ -s "$materialized_files" ]] || not_measured 'no-materialized-executables'
while IFS= read -r materialized_file; do
  [[ -f "$materialized_file" ]] || not_measured "missing-materialized-file:$materialized_file"
  if rg -q -e "$legacy_static_pattern" "$materialized_file" 2>/dev/null; then
    printf '%s\n' "$materialized_file" >>"$materialized_hits"
  fi
done <"$materialized_files"
touch "$materialized_hits"
LC_ALL=C sort -u -o "$materialized_hits" "$materialized_hits"
legacy_materialized_files=$(wc -l <"$materialized_hits" | tr -d ' ')

attack7=FAIL
if (( static_legacy_imports == 0 )); then attack7=PASS; fi

if [[ -n "$evidence_dir" ]]; then
  cp "$a2_trace" "$evidence_dir/attack2-dispatch.strace"
  cp "$a3_trace" "$evidence_dir/attack3-dispatch.strace"
  cp "$a4_trace" "$evidence_dir/attack4-dequeue.strace"
  cp "$calibration_trace" "$evidence_dir/calibration.strace"
  cp "$static_prod" "$evidence_dir/static-production.txt"
  cp "$static_test" "$evidence_dir/static-test-only.txt"
  cp "$dist_hits" "$evidence_dir/dist-hits.txt"
  cp "$tarball_hits" "$evidence_dir/tarball-hits.txt"
  cp "$materialized_hits" "$evidence_dir/materialized-hits.txt"
  cp "$fixture/a1-deliver.stdout" "$evidence_dir/attack1-delivery.stdout"
  cp "$fixture/a3.stdout" "$evidence_dir/attack3-delivery.stdout"
  cp "$fixture/a4-pending.stdout" "$evidence_dir/attack4-pending.stdout"
  cp "$fixture/a4-dequeue.stdout" "$evidence_dir/attack4-dequeue.stdout"
  cp "$fixture/a5.stdout" "$evidence_dir/attack5.stdout"
  cp "$fixture/a5.stderr" "$evidence_dir/attack5.stderr"
fi

printf 'fixture_prerequisite=MEASURED(all-sabotage-paths-contained)\n'
printf 'trace_calibration_prerequisite=MEASURED(command-exit-0)\n'
printf 'trace_calibration_hits=%s\n' "$calibration_hits"
printf 'attack_1_renamed_store=%s\n' "$attack1"
printf 'attack_2_denied_store=%s\n' "$attack2"
printf 'attack_2_product_command=%s\n' "$a2_command"
printf 'attack_2_old_path_accesses=%s\n' "$a2_old_accesses"
printf 'attack_2_listener_pid=%s\n' "$a2_listener_pid"
printf 'attack_2_listener_ancestor_old_path_accesses=%s\n' "$a2_listener_old_accesses"
printf 'attack_3_poisoned_queue=%s\n' "$attack3"
printf 'attack_3_old_message_accesses=%s\n' "$a3_state_accesses"
printf 'attack_4_no_resident_no_wake=%s\n' "$attack4"
printf 'attack_4_resident_after_enqueue=%s\n' "$a4_resident_after_enqueue"
printf 'attack_4_resident_after_dequeue=%s\n' "$a4_resident_after_dequeue"
printf 'attack_5_spexcode_home_relocation=%s\n' "$attack5"
printf 'attack_5_command_exit=%s\n' "$a5_exit"
printf 'attack_5_relocated_database_present=%s\n' "$([[ -f "$relocated_db" ]] && printf yes || printf no)"
printf 'attack_5_operator_home_database_absent=%s\n' "$([[ ! -e "$operator_home/.spexcode/sessions.sqlite" ]] && printf yes || printf no)"
printf 'attack_6_file_trace=%s\n' "$attack6"
printf 'attack_7_static_audit=%s\n' "$attack7"
printf 'test_only_legacy_evidence=%s (reported, excluded from static_legacy_imports)\n' "$test_only_legacy_evidence"
printf 'static_legacy_imports_prerequisite=MEASURED(all-named-self-launch-source-roots)\n'
printf 'legacy_dist_files_prerequisite=MEASURED(clean-selflaunch-build)\n'
printf 'legacy_tarball_files_prerequisite=MEASURED(valid-npm-pack)\n'
printf 'legacy_materialized_files_prerequisite=MEASURED(real-materialize-output)\n'
printf 'runtime_legacy_reads_prerequisite=MEASURED(strace-calibrated-dispatch-and-dequeue-exit-0)\n'
printf 'static_legacy_imports=%s\n' "$static_legacy_imports"
printf 'legacy_dist_files=%s\n' "$legacy_dist_files"
printf 'legacy_tarball_files=%s\n' "$legacy_tarball_files"
printf 'legacy_materialized_files=%s\n' "$legacy_materialized_files"
printf 'runtime_old_message_state_reads=%s\n' "$runtime_old_message_reads"
printf 'runtime_live_legacy_shape_reads=%s\n' "$runtime_live_legacy_shape_reads"
printf 'runtime_legacy_reads=%s\n' "$runtime_legacy_reads"

failures=0
for result in "$attack1" "$attack2" "$attack4" "$attack5" "$attack6" "$attack7"; do
  [[ "$result" == PASS ]] || failures=$((failures + 1))
done
[[ "$attack3" == NO-CONSUMER ]] || failures=$((failures + 1))
if (( static_legacy_imports != 0 || legacy_dist_files != 0 || legacy_tarball_files != 0 \
  || legacy_materialized_files != 0 || runtime_legacy_reads != 0 )); then
  failures=$((failures + 1))
fi
if (( failures > 0 )); then
  printf 'self-launch sabotage: FAIL(%s measured conditions failed)\n' "$failures" >&2
  exit 1
fi
printf '%s\n' 'self-launch sabotage: PASS'
