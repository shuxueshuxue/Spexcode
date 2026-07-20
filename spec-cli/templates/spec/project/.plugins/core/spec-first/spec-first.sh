#!/usr/bin/env bash
# @@@ spec-first - a one-shot governed READ gate. It advances only when the adapter resolves a read path AND
# the spec graph resolves a real `code:` governor for that path. Irrelevant tools, unresolvable reads, and
# uncovered/related-only files leave the sentinel absent, so any number of ungoverned reads cannot mute the
# first later governed read. That read spends the gate and blocks once with its actual governor; retries pass.
# @@@ event vs matcher - materialized shims bind PreToolUse event-wide on every harness. hp_code_path ... read
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

paths=$(hp_code_path "$payload" read)
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
reason="Before accessing governed source $path, read its governing spec FIRST: $owner. Read the relevant NEIGHBORS too: the parent that scopes it, the siblings it borders, and the children that refine it. Then reconcile deliberately: change the spec if the intent is changing, or make the code honor it. The one forbidden move is code that silently diverges from its spec. (Fires once per session, at the first governed code read.)"
esc=$(printf '%s' "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS=""} NR>1{print "\\n"} {print}')
printf '{"decision":"block","reason":"%s"}\n' "$esc"
exit 0
