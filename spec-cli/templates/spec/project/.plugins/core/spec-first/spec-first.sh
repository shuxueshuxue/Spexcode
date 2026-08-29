#!/usr/bin/env bash
# @@@ spec-first - a one-shot governed ACCESS gate. It advances only when the adapter resolves a path the
# agent is about to READ OR MUTATE AND the spec graph resolves a real `code:` governor for that path.
# Irrelevant tools, unresolvable paths, and uncovered/related-only files leave the sentinel absent, so any
# number of ungoverned touches cannot mute the first later governed one. That touch spends the gate and blocks
# once with its actual governor; retries pass.
# @@@ why BOTH read and mutate - this gate has been narrowed twice and both narrowings reopened the same hole
# from opposite sides. Mutation-only let a pure analysis session reason straight from the code without ever
# opening the contract; read-only lets a session whose first governed touch is an Edit or Write do the same
# thing while writing. The rule in [[core]] is read the contract FIRST, and a blind write is its strongest
# case, so the trigger is any governed access. Narrowing it again needs a reason written down here.
# @@@ event vs matcher - materialized shims bind PreToolUse event-wide on every harness. hp_code_path ... access
# is the ONE adapter matcher that reduces Claude/Codex payload differences to a path. This handler owns the
# harness-agnostic state transition and governor lookup; it has no tool-name, harness, or filename branches.
# @@@ all sessions, global sentinel - file governance is independent of a record's `governed` bit, so the
# same gate serves dashboard and self-launched agents. The sentinel lives in the per-session global store dir
# (see hp_store_dir) and is created only by the first governed read. cwd = the worktree.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
S="${SPEX:-spex}"
payload=$(cat 2>/dev/null)
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
sent="$sdir/spec-checked"
[ -f "$sent" ] && exit 0

paths=$(hp_code_path "$payload" access)
[ -n "$paths" ] || exit 0
repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# The internal projection uses the authoritative code: edge resolver and emits stable id<TAB>spec-path rows;
# empty output means uncovered or related-only, deliberately a non-transition.
path=""; owner=""
while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue
  governors=$(cd "$repo" && $S internal spec-governors "$candidate" 2>/dev/null)
  [ -n "$governors" ] || continue
  path="$candidate"
  owner=$(printf '%s\n' "$governors" | awk -F '\t' 'BEGIN{sep=""} {printf "%s%s [%s]",sep,$2,$1; sep=", "}')
  break
done <<EOF
$paths
EOF
[ -n "$owner" ] || exit 0

mkdir -p "$sdir"; : > "$sent"
reason=$($S internal hook-prompt spec-first --path "$path" --owner "$owner") || exit 1
esc=$(printf '%s' "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS=""} NR>1{print "\\n"} {print}')
printf '{"decision":"block","reason":"%s"}\n' "$esc"
exit 0
