#!/usr/bin/env bash
set -eu

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "usage: $0 <source-checkout> <output-dir> <fail-first|canonical> [inherited-spex]" >&2
  exit 2
fi

source_checkout=$(cd "$1" && pwd -P)
mkdir -p "$2"
output_dir=$(cd "$2" && pwd -P)
mode=$3
inherited_spex=${4:-}
case "$mode" in
  fail-first)
    [ -n "$inherited_spex" ] || {
      echo "fail-first requires the external SPEX path whose inheritance is under test" >&2
      exit 2
    }
    ;;
  canonical) ;;
  *) echo "mode must be fail-first or canonical" >&2; exit 2 ;;
esac

fixture=$(mktemp -d "${TMPDIR:-/tmp}/spex-m4-self-launch-${mode}.XXXXXX")
project="$fixture/project"
store="$fixture/store"
temp="$fixture/tmp"
database="$fixture/db/sessions.sqlite"
runner="$fixture/run-trace.sh"

for resolved in "$fixture" "$project" "$store" "$temp" "$database" "$runner"; do
  printf 'ASSERT fixture-path %s\n' "$resolved"
  case "$resolved" in
    "$fixture"|"$fixture"/*) ;;
    *) printf 'fixture escape: %s\n' "$resolved" >&2; exit 97 ;;
  esac
done

node24_bin=${NODE24_BIN:-/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64/bin}
node22_bin=${NODE22_BIN:-/home/jeffry/.nvm/versions/node/v22.21.0/bin}
for required in "$node24_bin/node" "$node24_bin/npm" "$node22_bin/node" "$node22_bin/npm"; do
  [ -x "$required" ] || { printf 'required executable missing: %s\n' "$required" >&2; exit 3; }
done

mkdir -p "$store" "$temp" "$fixture/db"
git clone --quiet "$source_checkout" "$project"
git -C "$project" checkout --detach ca51f4ca5281439bbc45933402e502069100a5a0

(
  cd "$project"
  env PATH="$node24_bin:/usr/bin:/bin" npm install
  env PATH="$node22_bin:/usr/bin:/bin" npm run build
  env PATH="$node22_bin:/usr/bin:/bin" npm run build --workspace=@spexcode/session-protocol
  env PATH="$node22_bin:/usr/bin:/bin" npm run build --workspace=@spexcode/session-selflaunch
)

cat > "$runner" <<'RUNNER'
#!/usr/bin/env bash
set -eu

fixture=$1
mode=$2
inherited_spex=${3:-}
project="$fixture/project"
store="$fixture/store"
temp="$fixture/tmp"
database="$fixture/db/sessions.sqlite"
session_id=self-launch-trace-codex

for resolved in "$project" "$store" "$temp" "$database"; do
  printf 'ASSERT fixture-path %s\n' "$resolved"
  case "$resolved" in
    "$fixture"/*) ;;
    *) printf 'fixture escape: %s\n' "$resolved" >&2; exit 97 ;;
  esac
done

export PATH="${NODE22_BIN:-/home/jeffry/.nvm/versions/node/v22.21.0/bin}:/usr/bin:/bin"
export HOME="$fixture/home"
export SPEXCODE_HOME="$store"
export TMPDIR="$temp"
export CLAUDE_PROJECT_DIR="$project"
if [ "$mode" = canonical ]; then
  export SPEX="$project/spec-cli/bin/spex.mjs"
  export SPEXCODE_API_URL=
  unset SPEX_HOOK_MANIFEST GIT_DIR GIT_INDEX_FILE
else
  export SPEX="$inherited_spex"
fi
mkdir -p "$HOME"
cd "$project"

printf 'STEP materialize\n'
node spec-cli/bin/spex.mjs materialize

runtime_key=$(printf '%s' "$project" | sed 's#[/.]#-#g')
runtime_root="$store/projects/$runtime_key"
tree_key=$(printf '%s' "$project" | sed 's#[/.]#-#g')
tree_slot="$runtime_root/trees/$tree_key"
for resolved in "$runtime_root" "$tree_slot"; do
  printf 'ASSERT runtime-path %s\n' "$resolved"
  case "$resolved" in
    "$fixture"/*) ;;
    *) printf 'fixture escape: %s\n' "$resolved" >&2; exit 98 ;;
  esac
done
printf 'MANIFEST %s\n' "$tree_slot/hooks-manifest"
command grep -n '' "$tree_slot/hooks-manifest"

fire() {
  event=$1
  payload=$2
  expected=$3
  set +e
  printf '%s' "$payload" | bash spec-cli/hooks/dispatch.sh codex "$event"
  actual=$?
  set -e
  printf '\nEVENT %s rc=%s expected=%s\n' "$event" "$actual" "$expected"
  [ "$actual" -eq "$expected" ]
}

fire SessionStart '{"session_id":"self-launch-trace-codex","hook_event_name":"SessionStart"}' 0
fire UserPromptSubmit '{"session_id":"self-launch-trace-codex","hook_event_name":"UserPromptSubmit"}' 0
read_payload='{"session_id":"self-launch-trace-codex","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"nl -ba spec-cli/src/hooks.ts"}}'
fire PreToolUse "$read_payload" 2
fire PreToolUse "$read_payload" 0
edit_payload='{"session_id":"self-launch-trace-codex","hook_event_name":"PostToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Update File: docs/session-platform-m4-self-launch-cutover.md\\n@@\\n"}}'
fire PostToolUse "$edit_payload" 0
fire Stop '{"session_id":"self-launch-trace-codex","hook_event_name":"Stop","stop_hook_active":false}' 0

printf 'STEP self-launch-cli initialize\n'
node packages/session-selflaunch/bin/spex-session.mjs initialize --database-path "$database" --session-id "$session_id"
printf 'STEP self-launch-cli enqueue\n'
node packages/session-selflaunch/bin/spex-session.mjs enqueue --database-path "$database" --session-id "$session_id" --kind audit --body message --idempotency-key trace-1
printf 'STEP self-launch-cli pending\n'
node packages/session-selflaunch/bin/spex-session.mjs pending --database-path "$database" --session-id "$session_id"
printf 'STEP self-launch-cli dequeue\n'
node packages/session-selflaunch/bin/spex-session.mjs dequeue --database-path "$database" --session-id "$session_id"

test ! -e "$runtime_root/sessions/$session_id/session.json"
printf 'ASSERT no-governed-record %s\n' "$runtime_root/sessions/$session_id/session.json"
RUNNER
chmod 755 "$runner"

if [ "$mode" = canonical ]; then
  trace_file="$output_dir/trace.canonical.raw.log"
  events_file="$output_dir/hook-events.canonical.raw.txt"
else
  trace_file="$output_dir/trace.raw.log"
  events_file="$output_dir/hook-events.raw.txt"
fi

NODE22_BIN="$node22_bin" /usr/bin/strace -f -qq -e trace=%file -s 4096 -o "$trace_file" \
  bash "$runner" "$fixture" "$mode" "$inherited_spex" > "$events_file" 2>&1
sha256sum "$trace_file" "$events_file"
printf 'fixture retained at %s\n' "$fixture"
