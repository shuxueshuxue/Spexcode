#!/usr/bin/env bash
# @@@ stop-gate - a blocking Stop hook with TWO jobs, each with a HARD loop-break (never blocks more than
# once on the same cause, never leaks a dishonest stop):
#   (A) COMMIT GATE — a done/merge proposal (awaiting + merge|nothing) is rejected while the node branch has
#       uncommitted work or 0 commits ahead of main; the dogfood ritual commits BEFORE proposing. Clean ->
#       allow; dirty -> block once with the reason, escape on the continuation to honest `blocked`.
#   (B) DECLARE GATE — a session may not stop in an undeclared (`active`) state:
#         declared (awaiting/blocked/error/needs-input) . allow (the agent reported; nothing to do)
#         active, first stop  (stop_hook_active false) .. block ONCE — instruct the agent to declare
#         active, the continuation (stop_hook_active true) auto-declare a safe default (awaiting/nothing if
#                                                          committed, else blocked) and allow. Guaranteed to end.
# $SPEX is the PATH-independent CLI invocation (abs tsx + cli) injected by settingsArg, so the gate's
# own auto-default AND the command it shows the agent both work even when `spex` is absent from PATH.
# Runs with cwd = the session worktree; state is the deterministic, file-based .session.
S="${SPEX:-spex}"
input=$(cat 2>/dev/null || true)
status=$(sed -n 's/^status:[[:space:]]*//p' .session 2>/dev/null | head -1)
proposal=$(sed -n 's/^proposal:[[:space:]]*//p' .session 2>/dev/null | head -1)

# the value of the payload's structured `stop_hook_active` field (true on the hook-forced continuation),
# read by field name rather than substring-sniffing the JSON blob. ([a-z]* captures true/false portably —
# BSD sed has no \| alternation.)
cont=$(printf '%s' "$input" | sed -n 's/.*"stop_hook_active"[[:space:]]*:[[:space:]]*\([a-z]*\).*/\1/p')

# @@@ commit gate - a declaration of done/merge (awaiting + proposal merge|nothing) is only honest once the
# node branch carries the work as COMMITS: the dogfood ritual commits spec+code BEFORE any proposal, yet a
# dashboard-launched agent kept proposing merge with 0 commits / a dirty tree. So before allowing such a
# declaration we run the deterministic check (`spex session commit-gate`, which goes through git.ts's git()
# so the hook's GIT_DIR/GIT_INDEX_FILE can't misdirect repo discovery). Clean -> allow. Dirty/0-ahead ->
# block ONCE with the specific reason + commit instructions; on the forced continuation (the agent ignored
# it) escape the loop by downgrading to `blocked` with a clear note, so a FALSE "ready to merge" never
# stands. (A propose-close declaration is exempt — it discards the worktree, so commits are moot.)
if [ "${status:-active}" = awaiting ] && { [ "$proposal" = merge ] || [ "$proposal" = nothing ]; }; then
  if gatemsg=$($S session commit-gate 2>&1); then
    exit 0   # work is committed and ahead of main -> the proposal is honest, let it stop.
  fi
  if [ "$cont" = true ]; then
    $S session block --note "stopped with uncommitted work — commit your spec+code on the node branch, then re-declare done" >/dev/null 2>&1 || true
    exit 0
  fi
  esc=$(printf '%s' "$gatemsg" | sed 's/[\\"]/\\&/g')
  printf '{"decision":"block","reason":"Not ready to declare done: %s. The dogfood ritual lands every change as a git commit on your node branch BEFORE you propose. Commit your spec.md + code on this node branch (spec: <id> — <reason>, with a Session: trailer), then re-run %s session done --propose %s."}\n' "$esc" "$S" "$proposal"
  exit 0
fi

# any OTHER already-declared state (blocked / error / needs-input / awaiting+close) -> let it stop.
[ "${status:-active}" != "active" ] && exit 0

if [ "$cont" = true ]; then
  # the forced continuation also stopped without declaring -> escape the loop, don't block. Keep the commit
  # gate airtight: default to awaiting/nothing only when the branch is actually committed+ahead; otherwise an
  # undeclared stop with uncommitted work becomes honest `blocked`, never a false awaiting/done.
  if $S session commit-gate >/dev/null 2>&1; then
    $S session state awaiting --propose nothing --note "auto: stopped without declaring" >/dev/null 2>&1 || true
  else
    $S session block --note "auto: stopped without declaring and with uncommitted work — commit your spec+code on the node branch, then declare" >/dev/null 2>&1 || true
  fi
  exit 0
fi

# first stop in an undeclared state -> nudge exactly once with PATH-independent commands.
printf '{"decision":"block","reason":"You are stopping without declaring this session'"'"'s state, so its outcome would be guessed instead of recorded. Declare what should happen next by running exactly one of these, then stop: %s session done --propose merge (ready to review/merge) ; %s session done --propose nothing (paused, awaiting the human) ; %s session block --note <what-you-await> (waiting on a background task, you will self-resume) ; %s session done --propose close (propose discarding this worktree) ; %s session ask --note <your-question> (you are asking the human a question; you will resume when they answer)."}\n' "$S" "$S" "$S" "$S" "$S"
exit 0
