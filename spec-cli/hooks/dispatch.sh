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
# args: `<harness> <Event>`. The harness id is explicit. `plugin` is the bundle form ([[plugin-harness]]),
# `opencode` the generated event-bus plugin
# ([[opencode-harness]]), `pi` the generated extension ([[pi-harness]]), and `zcode` the native adapter: all four
# carry Claude-shaped payloads (Claude tool names + file_path), so they join the claude branch in harness.sh via
# the default case — no parse arm of their own.
harness=claude
case "${1:-}" in claude|codex|opencode|pi|zcode|plugin) harness="$1"; shift ;; *)
  printf 'dispatch.sh: missing or unknown harness id\n' >&2
  exit 64
;; esac
event="${1:?usage: dispatch.sh <harness> <Event>}"
export SPEXCODE_HARNESS="$harness"
# the harness.sh path (the adapter's shell mirror) — sibling of this script; hook handlers source it, and we
# source it here too for hp_runtime_dir (the per-project store dir).
hook_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SPEXCODE_HARNESS_LIB="$hook_root/harness.sh"
. "$SPEXCODE_HARNESS_LIB"
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
# the manifest lives in THIS tree's materialize slot of the GLOBAL per-project store (mirrors layout.treeSlotDir),
# NOT the worktree — and per tree, so a dispatch can only read the manifest of the tree it fires in
# ([[hook-dispatch]]). Slot key = this cwd's rev-parse --show-toplevel through hp_tree_dir. Empty if git
# can't resolve.
rt="$(cd "$proj" 2>/dev/null && hp_runtime_dir)" || rt=""
slot="$(cd "$proj" 2>/dev/null && hp_tree_dir)" || slot=""

# A project transport can outlive the tree that installed it. The current tree's last successful materialize
# is the authority for whether its events are active. A tree without a published selection is inert.
allowed="$slot/harnesses"
if [ -f "$allowed" ]; then
  grep -Fxq "$harness" "$allowed" || exit 0
elif [ -f "$rt/harness-selection-v1" ]; then
  exit 0
fi

# --- dispatch ---------------------------------------------------------------------------------------------
manifest="${SPEX_HOOK_MANIFEST:-$slot/hooks-manifest}"
[ -f "$manifest" ] || { printf 'dispatch.sh: current tree has no hook manifest\n' >&2; exit 78; }
input="$(cat 2>/dev/null || true)"    # capture stdin ONCE; each handler gets its own copy
err="/tmp/.spex-hook-$$.err"          # per-dispatch (pid-unique) stderr capture; no cross-session race
cleanup() { rm -f "$err"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
rc=0
# manifest line: event<TAB>order<TAB>block<TAB>script  (pre-sorted by event,order,script)
while IFS=$'\t' read -r ev order block script; do
  [ "$ev" = "$event" ] || continue
  handler="$proj/$script"
  out="$(printf '%s' "$input" | bash "$handler" 2>"$err")"; code=$?
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
  # FAIL LOUD. A non-blocking handler's failure used to vanish completely: its exit code was dropped and its
  # stderr was overwritten by the next handler and deleted on exit, so a lifecycle hook that could not write
  # left NO trace anywhere — the board kept whatever state it last held and the reader had to guess whether
  # the hook had run at all. That silence is what let a whole fleet's mark-active and stop-gate die unnoticed.
  # Reporting is all this does: a non-blocking hook must not change the dispatch verdict, so `rc` stays the
  # blocking handlers' to set, and a noisy hook can never turn into a gate.
  if [ "$code" != 0 ] && [ "$block" != "true" ]; then
    printf 'dispatch.sh: %s handler %s exited %s\n' "$event" "$script" "$code" >&2
    [ -s "$err" ] && cat "$err" >&2
  fi
done < "$manifest"
exit "$rc"
