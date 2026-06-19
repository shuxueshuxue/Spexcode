#!/usr/bin/env bash
# @@@ stop-gate - a blocking Stop hook that forces the agent to author its own state, with a HARD
# loop-break. A session may not stop in an undeclared (`active`) state; but we never block more than
# once, and we never leak an undeclared stop:
#   declared (awaiting/blocked/error) ............... allow (the agent reported; nothing to do)
#   active, first stop  (stop_hook_active false) .... block ONCE — ask the agent to declare
#   active, the continuation (stop_hook_active true)  do NOT block again → auto-declare a safe default
#                                                     (awaiting, noted) and allow. Guaranteed to end.
# Runs with cwd = the session worktree; state is the deterministic, file-based .session.
input=$(cat 2>/dev/null || true)
status=$(sed -n 's/^status:[[:space:]]*//p' .session 2>/dev/null | head -1)

# already declared by the agent → let it stop.
[ "${status:-active}" != "active" ] && exit 0

case "$input" in
  *'"stop_hook_active":true'*|*'"stop_hook_active": true'*)
    # the forced continuation also stopped without declaring → escape the loop: default it, don't block.
    spex session state awaiting --propose nothing --note "auto: stopped without declaring" >/dev/null 2>&1 || true
    exit 0 ;;
esac

# first stop in an undeclared state → nudge exactly once.
printf '%s\n' '{"decision":"block","reason":"Declare this session'"'"'s state before stopping so the manager can act — run exactly one: `spex session done --propose merge` (ready to review/merge), `spex session done --propose nothing` (paused, awaiting the human), `spex session block --note \"<what you await>\"` (waiting on a background task; you will self-resume), or `spex session done --propose close` (propose discarding). Then stop."}'
exit 0
