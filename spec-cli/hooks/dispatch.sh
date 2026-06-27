#!/usr/bin/env bash
# @@@ dispatch - the SINGLE hook entry point for ALL harness lifecycle events. The committed `.claude`/
# `.codex` shim binds one line per event to `dispatch.sh <Event>`; this runs every `surface: hook` node
# bound to that event, in manifest order, feeding each the ORIGINAL hook stdin. It reproduces the native
# multi-hook semantics — which on BOTH Claude Code and Codex run matching hooks in PARALLEL with no order
# guarantee — but DETERMINISTICALLY: all hooks run (so every side effect is preserved), their stdout
# (additionalContext) is concatenated through, and a hook that DECLARED `block: true` and exits 2 makes the
# dispatch exit 2 with that hook's stderr — the one signal the harness propagates back to the model. Pure
# bash, no node boot on the hot path (PreToolUse fires on every tool call). cwd = the session worktree.
# $SPEX (abs tsx+cli) is inherited from the shim env for the handlers that need the cli; pure-shell handlers
# ignore it. The manifest is compiled once per session by sessionstart.sh.
set -u
event="${1:?usage: dispatch.sh <Event>}"
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
manifest="${SPEX_HOOK_MANIFEST:-.session/hooks-manifest}"
[ -f "$manifest" ] || exit 0          # no compiled manifest (e.g. compile not yet run) → no hooks to dispatch
input="$(cat 2>/dev/null || true)"    # capture stdin ONCE; each handler gets its own copy
err="/tmp/.spex-hook-$$.err"          # per-dispatch (pid-unique) stderr capture; no cross-session race
trap 'rm -f "$err"' EXIT
rc=0
# manifest line: event<TAB>order<TAB>block<TAB>script  (pre-sorted by event,order,script)
while IFS=$'\t' read -r ev order block script; do
  [ "$ev" = "$event" ] || continue
  out="$(printf '%s' "$input" | bash "$proj/$script" 2>"$err")"; code=$?
  [ -n "$out" ] && printf '%s' "$out"
  if [ "$block" = "true" ] && [ "$code" = "2" ]; then
    cat "$err" >&2
    rc=2
  fi
done < "$manifest"
exit "$rc"
