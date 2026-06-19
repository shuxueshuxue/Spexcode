#!/usr/bin/env bash
# @@@ stop-gate - a blocking Stop hook that forces the agent to author its own state, with a HARD
# loop-break. A session may not stop in an undeclared (`active`) state; but we never block more than
# once, and never leak an undeclared stop:
#   declared (awaiting/blocked/error) ............... allow (the agent reported; nothing to do)
#   active, first stop  (stop_hook_active false) .... block ONCE — instruct the agent to declare
#   active, the continuation (stop_hook_active true)  do NOT block again -> auto-declare a safe default
#                                                     (awaiting, noted) and allow. Guaranteed to end.
# $SPEX is the PATH-independent CLI invocation (abs tsx + cli) injected by settingsArg, so the gate's
# own auto-default AND the command it shows the agent both work even when `spex` is absent from PATH.
# Runs with cwd = the session worktree; state is the deterministic, file-based .session.
S="${SPEX:-spex}"
input=$(cat 2>/dev/null || true)
status=$(sed -n 's/^status:[[:space:]]*//p' .session 2>/dev/null | head -1)

# already declared by the agent -> let it stop.
[ "${status:-active}" != "active" ] && exit 0

case "$input" in
  *'"stop_hook_active":true'*|*'"stop_hook_active": true'*)
    # the forced continuation also stopped without declaring -> escape the loop: default it, don't block.
    $S session state awaiting --propose nothing --note "auto: stopped without declaring" >/dev/null 2>&1 || true
    exit 0 ;;
esac

# first stop in an undeclared state -> nudge exactly once with PATH-independent commands.
printf '{"decision":"block","reason":"You are stopping with an undeclared state, so the manager cannot act. Run exactly one of these, then stop: %s session done --propose merge (ready to review/merge) ; %s session done --propose nothing (paused, awaiting the human) ; %s session block --note <what-you-await> (waiting on a background task, you will self-resume) ; %s session done --propose close (propose discarding this worktree) ; %s session ask --note <your-question> (you are asking the human a question; you will resume when they answer)."}\n' "$S" "$S" "$S" "$S" "$S"
exit 0
