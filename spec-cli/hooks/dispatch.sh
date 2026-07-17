#!/usr/bin/env bash
# @@@ dispatch - the SINGLE hook entry point for ALL harness lifecycle events. The shim (.claude/settings.json
# / .codex/hooks.json, written by each [[harness-adapter]]) binds one line per event to
# `dispatch.sh <harness> <Event>` — the harness id is BAKED IN by the adapter that wrote the shim, so this is
# the deterministic harness DETECTOR for the shell side: we export SPEXCODE_HARNESS (read by harness.sh, the
# adapter's shell mirror, which the hook handlers source) without ever sniffing the payload shape. ONE job:
#   DISPATCH — run every handler bound to <Event> from the persistent manifest, in order, feeding each the
#   ORIGINAL stdin. Reproduces the native parallel multi-hook contract DETERMINISTICALLY: all handlers run
#   (side effects preserved), their stdout (decision/additionalContext) is concatenated through, and a
#   block:true handler that exits 2 makes the dispatch exit 2 with that handler's stderr — the one signal
#   the harness propagates. Pure bash, no node boot on the hot path. cwd = the project/worktree. $SPEX (abs
#   tsx+cli) is inherited from the shim env.
#
# The old (1) GATE — an auto-materialize when the config content-hash moved — is RETIRED ([[commit-surgery]]):
# a harness event is never a materialize trigger; the materialize anchors are git-native only (spex verbs,
# session-worktree creation, and the pre-commit/post-checkout/post-merge hooks). .plugins edits are
# git-transactional: they take effect at the commit/checkout/merge that carries them, like any other source.
set -u
# args: `<harness> <Event>`. A harness id as $1 (claude|codex|opencode|pi|plugin) is consumed; otherwise we keep
# $1 as the event and default the harness to claude — so a stale shim still written as `dispatch.sh <Event>`
# keeps working. `plugin` is the bundle form ([[plugin-harness]]), `opencode` the generated event-bus plugin
# ([[opencode-harness]]), and `pi` the generated extension ([[pi-harness]]): all three SYNTHESIZE claude-shaped
# payloads (Claude tool names + file_path), so they join the claude branch in harness.sh via the default case —
# no parse arm of their own.
harness=claude
case "${1:-}" in claude|codex|opencode|pi|plugin) harness="$1"; shift ;; esac
event="${1:?usage: dispatch.sh <harness> <Event>}"
export SPEXCODE_HARNESS="$harness"
# the harness.sh path (the adapter's shell mirror) — sibling of this script; hook handlers source it, and we
# source it here too for hp_runtime_dir (the per-project store dir).
export SPEXCODE_HARNESS_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness.sh"
. "$SPEXCODE_HARNESS_LIB"
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
# the manifest lives in THIS tree's materialize slot of the GLOBAL per-project store (mirrors layout.treeSlotDir),
# NOT the worktree — and per tree, so a dispatch can only read the manifest of the tree it fires in
# ([[hook-dispatch]]). Slot key = this cwd's rev-parse --show-toplevel through hp_tree_dir. Empty if git
# can't resolve.
rt="$(cd "$proj" 2>/dev/null && hp_runtime_dir)" || rt=""
slot="$(cd "$proj" 2>/dev/null && hp_tree_dir)" || slot=""

# --- dispatch ---------------------------------------------------------------------------------------------
if [ -n "${SPEX_HOOK_MANIFEST:-}" ]; then
  manifest="$SPEX_HOOK_MANIFEST"
else
  # migration window: a tree last materialized by a pre-slot toolchain has no slot until its next git-native
  # anchor — fall back to the legacy global manifest (its exact pre-migration behavior) so no hook (the
  # Stop gate included) silently no-ops. The legacy file is never written again; the next anchor plants the
  # slot and this branch goes dead.
  manifest="$slot/hooks-manifest"
  [ -f "$manifest" ] || manifest="$rt/hooks-manifest"
fi
[ -f "$manifest" ] || exit 0          # no manifest yet (materialize never ran) → nothing to dispatch
input="$(cat 2>/dev/null || true)"    # capture stdin ONCE; each handler gets its own copy
err="/tmp/.spex-hook-$$.err"          # per-dispatch (pid-unique) stderr capture; no cross-session race
trap 'rm -f "$err"' EXIT
rc=0
# manifest line: event<TAB>order<TAB>block<TAB>script  (pre-sorted by event,order,script)
while IFS=$'\t' read -r ev order block script; do
  [ "$ev" = "$event" ] || continue
  out="$(printf '%s' "$input" | bash "$proj/$script" 2>"$err")"; code=$?
  [ -n "$out" ] && printf '%s' "$out"
  if [ "$block" = "true" ] && { [ "$code" = "2" ] || printf '%s' "$out" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"'; }; then
    cat "$err" >&2
    # codex reads a Stop block's continuation prompt from STDERR (+ exit 2), NOT the claude-style
    # decision:block JSON a handler writes to stdout. So when we block on the JSON path under codex and the
    # handler left stderr empty, extract its "reason" and forward it to stderr — else codex sees exit 2 with
    # no stderr ("Stop hook exited with code 2 but did not write a continuation prompt"). Claude is unchanged
    # (it keeps reading the stdout JSON). The reason is the JSON's last field, so capture to the final `"}`.
    if [ "$SPEXCODE_HARNESS" = codex ] && [ ! -s "$err" ]; then
      printf '%s' "$out" | sed -n 's/.*"reason"[[:space:]]*:[[:space:]]*"\(.*\)"[[:space:]]*}[[:space:]]*$/\1/p' \
        | sed 's/\\"/"/g; s/\\\\/\\/g' >&2
    fi
    rc=2
  fi
done < "$manifest"
exit "$rc"
