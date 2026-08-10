#!/usr/bin/env bash
# @@@ stop-gate - a blocking Stop hook with TWO jobs, each with a HARD loop-break (never blocks more than
# once on the same cause, never leaks a dishonest stop):
#   (A) COMMIT GATE — a done/merge proposal (awaiting + merge; legacy nothing remains readable) is rejected while the node branch has
#       uncommitted work or 0 commits ahead of main; the dogfood ritual commits BEFORE proposing. Clean ->
#       allow; dirty -> block once with the reason, escape on the continuation to `asking` (needs the human).
#   (B) DECLARE GATE — a session may not stop in an undeclared (`active`) state:
#         declared (awaiting/parked/error/asking) . allow (the agent reported; nothing to do)
#         active, first stop  (stop_hook_active false) .. block ONCE — instruct the agent to declare
#         active, the continuation (stop_hook_active true) auto-declare `asking` and allow. Guaranteed to end
#                                          without inventing a completion state.
# $SPEX is the PATH-independent CLI invocation (abs tsx + cli) injected by settingsArg, so the gate's own
# auto-default AND the command it shows the agent both work even when `spex` is absent from PATH.
# @@@ global store + governed gate - state lives in the per-session GLOBAL record session.json (keyed by the
# harness session_id from the payload, grouped per-project — mirrors spec-cli/src/layout.ts). The gate acts
# ONLY on a GOVERNED (dashboard-launched) session: a user-self-launched agent has no board to feed, so an
# undeclared stop is none of our business — we exit 0 SILENTLY (the bug this fixes: the declare-demand
# misfiring on a self-launched codex/claude). cwd = the session worktree (resolves the project key + the
# commit-gate's git); state writes go through `$SPEX session … --session <id>` (TS owns the JSON).
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
S="${SPEX:-spex}"
input=$(cat 2>/dev/null || true)
sid=$(hp_session_id "$input"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
rec="$sdir/session.json"
# non-governed (or no record) → silently let the stop through. THIS is the self-launch fix.
grep -q '^[[:space:]]*"governed"[[:space:]]*:[[:space:]]*true,\?$' "$rec" 2>/dev/null || exit 0

# read a CLOSED-VOCABULARY field (status / proposal) off its OWN line. The record is one-field-per-line from
# the single writer ([[sessions-core]]), so anchoring to the line start is what keeps a neighbouring note's
# escaped quote from being read as this field's value — the read half of the same rule that stops shell from
# ever composing the record.
jget() { sed -n "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\",\?$/\1/p" "$rec" 2>/dev/null | head -1; }
status=$(jget status)
proposal=$(jget proposal)

# the value of the payload's structured `stop_hook_active` field (true on the hook-forced continuation),
# read by field name rather than substring-sniffing the JSON blob. ([a-z]* captures true/false portably —
# BSD sed has no \| alternation.)
cont=$(printf '%s' "$input" | sed -n 's/.*"stop_hook_active"[[:space:]]*:[[:space:]]*\([a-z]*\).*/\1/p')

# @@@ eval advisory - a nudge (never a gate) emitted when a session stops CLEAN-DONE (committed work + a
# done/awaiting declaration): the agent IS the measuring hand, so an eval gap in what it just changed is a
# blind spot to flag the moment work lands. SCOPED via `spex eval lint --changed` to the nodes THIS branch
# touched — so an agent is never nagged about a score that went stale in a node it never opened (the bug
# that made three workers ask "is this mine?"). Three gap classes it surfaces: eval-drift / eval-missing
# (a node with an eval.md whose score is stale / unmeasured) and eval-coverage (a FRONTEND node with no
# eval.md — an obvious UI change carrying no loss signal). Delivered via the Stop hook's additionalContext
# (NEVER a block decision: a gap is a heads-up, not a wall). FIRES ONCE: the additionalContext itself forces
# one continuation, so the CALLER guards it on stop_hook_active — re-emitting on the forced re-stop is what
# looped 31 turns and tripped the Stop-hook block cap. Called only on ALLOW paths, never alongside a block.
#
# SURFACE-NEUTRAL: a stale/unmeasured score is refreshed only by PRODUCING the measurement on the scenario's
# OWN surface — a real run, never a desk check and never deferring to review a recording after the fact. The
# nudge privileges NO surface: `eval lint --changed` carries each drift/missing scenario's tag on its finding line
# ([[eval-core]]'s lint.scenarioTags — frontend-e2e / backend-api / cli / desktop / mobile), so the agent
# reads there WHICH surface to run. One line covers all five surfaces; there is no per-surface branch.
eval_advisory() {
  local out ids n msg esc
  # Codex Stop hooks reject the Claude-family `hookSpecificOutput.additionalContext` shape on allow paths.
  # Keep Codex Stop stdout empty unless it is a real block decision; the dispatcher still bridges block
  # reasons to Codex stderr.
  [ "${SPEXCODE_HARNESS:-claude}" = codex ] && return 0
  out=$($S eval lint --changed 2>&1)
  n=$(printf '%s\n' "$out" | grep -cE 'eval-(drift|missing|coverage):')
  [ "${n:-0}" -gt 0 ] || return 0   # no gap in what you changed (or eval lint unavailable) -> nothing to nudge
  ids=$(printf '%s\n' "$out" | sed -n "s/.*eval-[a-z]*: '\([^']*\)'.*/\1/p" | awk '!seen[$0]++' | head -6 | paste -sd' ' -)
  msg="eval — the loss signal the optimizer reads — flags ${n} gap(s) in nodes you changed: ${ids}. A node whose score went stale/unmeasured: re-measure it — PRODUCE the measurement YOURSELF with a real run of the scenario's actual surface (its tag on the \`spex eval lint --changed\` line tells you WHICH surface to run), compare to expected, and file it with \`spex eval add <node>\`; don't desk-check it, and don't defer to reviewing a recording after the fact. A FRONTEND node with no eval.md: give it one (a scenario — description + expected), since an obvious UI change should carry a loss signal. \`spex eval lint --changed\` lists them. (Advisory — fires once, not a gate.)"
  esc=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}\n' "$esc"
}

# @@@ commit gate - a declaration of done/merge (awaiting + proposal merge; legacy nothing is accepted only
# for backward-readable records) is only honest once the
# node branch carries the work as COMMITS: the dogfood ritual commits spec+code BEFORE any proposal, yet a
# dashboard-launched agent kept proposing merge with 0 commits / a dirty tree. So before allowing such a
# declaration we run the deterministic check (`spex internal commit-gate`, which goes through git.ts's git()
# so the hook's GIT_DIR/GIT_INDEX_FILE can't misdirect repo discovery). Clean -> allow. Dirty/0-ahead ->
# block ONCE with the specific reason + commit instructions; on the forced continuation (the agent ignored
# it) escape the loop by downgrading to `asking` (needs the human) with a clear note, so a FALSE "ready to
# merge" never stands. (A propose-close declaration is exempt — it discards the worktree, so commits are moot.)
# The PROPOSAL rides into the check: `merge` claims there is committed work to land (so 0-ahead blocks too),
# New public `done --propose nothing` calls trap before this hook; keep its legacy branch so historic records
# stop normally instead of becoming corrupt.
if [ "${status:-active}" = awaiting ] && { [ "$proposal" = merge ] || [ "$proposal" = nothing ]; }; then
  if gatemsg=$($S internal commit-gate "$proposal" 2>&1); then
    # nudge ONCE: emit on the natural stop, but STAY SILENT on the forced re-stop the additionalContext
    # itself causes (stop_hook_active=true). Without this guard the advisory re-fired every clean-done stop
    # and looped — the bug a prior change DESCRIBED in a comment but never actually implemented at the call.
    [ "$cont" != true ] && eval_advisory
    exit 0   # work is committed and ahead of main -> the proposal is honest, let it stop.
  fi
  if [ "$cont" = true ]; then
    $S session ask --session "$sid" --note "stopped with uncommitted work — commit your spec+code on the node branch, then re-declare done" >/dev/null 2>&1 || true
    exit 0
  fi
  esc=$(printf '%s' "$gatemsg" | sed 's/[\\"]/\\&/g')
  printf '{"decision":"block","reason":"Not ready to declare done: %s. The dogfood ritual lands every change as a git commit on your node branch BEFORE you propose. Commit your spec.md + code on this node branch (spec: <id> — <reason>, with a Session: trailer), then re-run %s session done --propose %s."}\n' "$esc" "$S" "$proposal"
  exit 0
fi

# Any other declared state (parked / error / asking / awaiting+close, plus legacy awaiting+nothing) stops.
[ "${status:-active}" != "active" ] && exit 0

if [ "$cont" = true ]; then
  # The forced continuation also stopped without declaring. Escape into asking: no default may invent a
  # completed lane, and the stopped agent now needs a human prompt to choose merge, close, ask, or park.
  $S session ask --session "$sid" --note "auto: stopped without declaring — choose merge, close, ask, or park; done --propose nothing records no state" >/dev/null 2>&1 || true
  exit 0
fi

# first stop in an undeclared state -> block. The FULL teaching text prints ONCE per session; every later
# undeclared stop gets a ONE-LINE version (a heavy session hits this gate 15-20x a night — re-printing the
# full menu each time is pure token noise). The once-sentinel is a plain file beside session.json in the
# session's global store dir — the same per-session-sentinel mechanism as the CLI's note-echo-taught; $sdir
# is already alias-resolved here, so a codex thread id lands on the same file, and an unwritable dir just
# teaches again (never blocks the block). The terse line must stay SELF-EXPLANATORY: an agent whose context
# was compacted may never have seen the full text, so the line carries the whole command menu, the
# declare-LAST discipline, and the `help session` entry that re-explains each choice's condition — every bit
# of the full-to-terse information gap is recoverable from the entry, none of it from memory.
taught="$sdir/stop-gate-taught"
if [ -f "$taught" ]; then
  printf '{"decision":"block","reason":"undeclared stop — declare the ONE true state as your LAST call: `%s session <done --propose merge (review; ONLY clickable merge)|close (close-pending; settled, no human decision/follow-up or posted artifact waiting)|park (parked; real wake-up + next action) / ask (asking; human reply/direction/decision, including reported finding/recommendation or handoff)>`. `done --propose nothing` is a trap: it writes no state and names these choices. Conditions: `%s help session`."}\n' "$S" "$S"
  exit 0
fi
touch "$taught" 2>/dev/null || true
# The full reason names the PATH-independent CLI ($S) ONCE as a shared `<CLI> session <choice>` prefix, then
# lists the four real states plus the `nothing` trap as a compact newline menu of bare subcommands — so the
# terminal output stays legible instead of repeating the long abs path per option. It EMPHASIZES that each
# state is a CLAIM others act on (not a box to tick to end the turn) and gives the precise APPLICATION CONDITION
# for each — so the agent picks the TRUE one. park is policed hardest because a false park (no real background task) reads on the
# board as "fine, self-resuming" when the agent actually needs the human, which is the most damaging mislabel.
# It ends with the ORDERING discipline — declare LAST, then stop — because a declaration followed by more
# tool calls honestly re-flips the record to active (mark-active, by design) and re-blocks the next stop;
# this block text is the one place every undeclared stopper is guaranteed to read, so the teaching that
# kills the park->block->re-park loop at its source lives here.
if [ -s "$sdir/files.json" ] && grep -qE '"[^"]+"' "$sdir/files.json"; then
  printf '{"decision":"block","reason":"a posted file/web artifact still needs human inspection; declare `spex session ask --note ...`, and declare it last."}\n'
  exit 0
fi
printf '{"decision":"block","reason":"Your session state is a CLAIM the graph, your supervisor, and other agents act on — not a box to tick to end the turn. Stopping undeclared makes your outcome a guess. Pick the ONE that is TRUE right now and run `%s session <choice>`, choosing the <choice> whose condition holds:\\n  • done --propose merge  — spec+code COMMITTED on the branch and genuinely ready for human review. It declares REVIEW and is the ONLY proposal that offers a clickable merge.\\n  • done --propose nothing — TRAP: records no state. Choose merge, close, ask, or park below.\\n  • done --propose close — task genuinely settled, work landed (or none to merge), worktree no longer needed, and no human decision, follow-up, or posted artifact awaits inspection: propose human close. It declares CLOSE-PENDING, not merge. Never run `session close` on your own id.\\n  • ask --note <what-you-await> — a human reply, direction, or decision is needed, including a reported finding/recommendation, handoff, or posted-artifact inspection. It declares ASKING and resumes only when they reply.\\n  • park --note <what-you-await> — ONLY when a real wake-up will resume a named next action: a managed watch delivery or background task. A watch on terminal children is not a wake-up. It declares PARKED and self-resumes.\\n\\nDECLARE LAST, THEN STOP: finish everything else in the turn first — speak, send your messages, establish managed watches or arm background waits — and make the declaration your FINAL call. Any tool call AFTER it flips your record back to active (mark-active, by design: activity is activity), so the next stop re-blocks and demands a fresh declaration; declaring last kills that loop at its source.\\n\\n(This full explanation shows once per session; later undeclared stops get a one-line reminder. `%s help session` re-explains the choices any time.)"}\n' "$S" "$S"
exit 0
