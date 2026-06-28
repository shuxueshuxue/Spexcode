#!/usr/bin/env bash
# @@@ dispatch - the SINGLE hook entry point for ALL harness lifecycle events. The shim (.claude/settings.json
# / .codex/hooks.json, written by each [[harness-adapter]]) binds one line per event to
# `dispatch.sh <harness> <Event>` — the harness id is BAKED IN by the adapter that wrote the shim, so this is
# the deterministic harness DETECTOR for the shell side: we export SPEXCODE_HARNESS (read by harness.sh, the
# adapter's shell mirror, which the hook handlers source) without ever sniffing the payload shape. Two jobs,
# in order:
#   (1) GATE — a cheap pure-shell content hash of the config roots (~10ms, every event). If it moved since the
#       last render, re-run `spex materialize` (the ~0.85s node step) to bring manifest + contract (AGENTS.md/
#       CLAUDE.md block) + shims + Codex trust back in lockstep with the EDITABLE .config. Content-based, so it
#       catches bash/sed/user/other-agent/git edits alike (a tool-payload path would miss them). Serialized by
#       a lock with a re-check inside, so concurrent sessions never race the write (§ atomicity).
#   (2) DISPATCH — run every handler bound to <Event> from the persistent manifest, in order, feeding each the
#       ORIGINAL stdin. Reproduces the native parallel multi-hook contract DETERMINISTICALLY: all handlers run
#       (side effects preserved), their stdout (decision/additionalContext) is concatenated through, and a
#       block:true handler that exits 2 makes the dispatch exit 2 with that handler's stderr — the one signal
#       the harness propagates. Pure bash, no node boot on the hot path (node runs only inside the gate, only
#       on actual change). cwd = the project/worktree. $SPEX (abs tsx+cli) is inherited from the shim env.
set -u
# args: `<harness> <Event>`. A harness id as $1 (claude|codex) is consumed; otherwise we keep $1 as the event
# and default the harness to claude — so a stale shim still rendered as `dispatch.sh <Event>` keeps working.
harness=claude
case "${1:-}" in claude|codex) harness="$1"; shift ;; esac
event="${1:?usage: dispatch.sh <harness> <Event>}"
export SPEXCODE_HARNESS="$harness"
# the harness.sh path (the adapter's shell mirror) — sibling of this script; hook handlers source it, and we
# source it here too for hp_runtime_dir (the per-project store dir).
export SPEXCODE_HARNESS_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness.sh"
. "$SPEXCODE_HARNESS_LIB"
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
# the manifest + content-hash + gate lock live in the GLOBAL per-project store (mirrors layout.runtimeRoot),
# NOT the worktree — so the worktree carries zero SpexCode-rendered runtime. Empty if git can't resolve.
rt="$(cd "$proj" 2>/dev/null && hp_runtime_dir)" || rt=""

# --- (1) gate -------------------------------------------------------------------------------------------
# the config fingerprint is hp_config_hash (harness.sh, already sourced) — the SAME function materialize.ts
# shells to, so the gate and the renderer never disagree on "changed".
cur="$( (cd "$proj" 2>/dev/null && hp_config_hash) )"
if [ -n "$rt" ] && [ -n "$cur" ] && [ "$cur" != "$(cat "$rt/content-hash" 2>/dev/null || true)" ]; then
  mkdir -p "$rt" 2>/dev/null
  ( flock 9
    if [ "$cur" != "$(cat "$rt/content-hash" 2>/dev/null || true)" ]; then   # re-check: a sibling dispatch may have just rendered
      ( cd "$proj" && ${SPEX:-spex} materialize >/dev/null 2>&1 )
    fi
  ) 9>"$rt/.materialize.lock"
fi

# --- (2) dispatch ---------------------------------------------------------------------------------------
manifest="${SPEX_HOOK_MANIFEST:-$rt/hooks-manifest}"
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
    rc=2
  fi
done < "$manifest"
exit "$rc"
