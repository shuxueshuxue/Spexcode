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
# @@@ governed gate - the session id comes from the payload. The gate acts ONLY on a GOVERNED
# (dashboard-launched) session: a user-self-launched agent has no board to feed, so an undeclared stop is
# none of our business. Lifecycle status/proposal come from the canonical session application through one
# CLI read; this shell never treats runtime.json as a second lifecycle database.
SPEX_PROFILE_VALUE="${SPEX_PROFILE:-full}"
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
hp_profile_hook_enabled stop-gate
profile_status=$?
[ "$profile_status" -eq 1 ] && exit 0
[ "$profile_status" -ne 0 ] && exit "$profile_status"
S="${SPEX:-spex}"
# @@@ the block must survive its own text - three ways a decision was lost. (1) A `hook-prompt` failure exited
# non-zero, which for a Stop hook means ALLOW: the one gate whose job is to stop an undeclared stop was
# disarmed by its own text failing to load. (2) The escaping was written three times and only one folded
# newlines, so a multi-line reason put raw newlines inside a JSON string and the harness dropped the block.
# (3) `render` must only PRINT — a helper that emits the decision itself cannot be called inside `$( )`,
# because `exit` there ends the substitution and its output is captured as the caller's text. So rendering
# returns a status, and every decision is taken in the main shell.
esc_json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS=""} NR>1{print "\\n"} {print}'; }
block_with() { printf '{"decision":"block","reason":"%s"}\n' "$(esc_json "$1")"; exit 0; }
render() {
  local text
  text=$("$@" 2>/dev/null) || return 1
  [ -n "$text" ] || return 1
  printf '%s' "$text"
}
# A genuinely broken CLI would also stop the agent from declaring, so the fail-closed fallback blocks at most
# once per session and then steps aside loudly: failing closed must not trap anyone.
fallback_or_allow() {
  local once="$sdir/stop-gate-render-failed"
  if [ -f "$once" ]; then
    printf 'stop-gate: cannot render its own reason and has already blocked once for that; allowing this stop. Repair the spex CLI.\n' >&2
    exit 0
  fi
  # the bound only works if the mark can be written: without the mkdir a store dir that does not exist yet
  # left the sentinel uncreated, and "block at most once" quietly became "block every time"
  mkdir -p "$sdir" 2>/dev/null || true
  touch "$once" 2>/dev/null || true
  block_with "undeclared stop, and stop-gate could not render its own text (the spex CLI failed). Declare the ONE true state as your LAST call: session done --propose merge | done --propose close | ask --note <what you await> | park --note <what you await>. Run it through the same CLI this project launched you with; if that CLI is broken, say so and stop."
}

input=$(cat 2>/dev/null || true)
sid=$(hp_session_id "$input"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
# non-governed (or no record) → silently let the stop through. THIS is the self-launch fix. The CLI response
# is governed<TAB>status<TAB>proposal; status/proposal are canonical, while governed is identity metadata.
hook_state=$($S internal session-hook-state --session "$sid" 2>/dev/null) || exit 0
IFS=$'\t' read -r governed status proposal <<< "$hook_state"
[ "$governed" = 1 ] || exit 0

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
  msg=$($S internal hook-prompt stop-gate --variant eval --count "$n" --ids "$ids") || return 0
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
    # The hook is a thin boundary.  Do not call the porcelain declaration here: it may trigger
    # delivery/build work and can remain running after the harness has already accepted the stop.
    # The internal writer is the same canonical lifecycle path, with no dispatch side effects.
    $S internal session-state asking --session "$sid" --note "stopped with uncommitted work — commit your spec+code on the node branch, then re-declare done" >/dev/null 2>&1 || true
    exit 0
  fi
  reason=$(render $S internal hook-prompt stop-gate --variant commit --reason "$gatemsg" --cli "$S" --propose "$proposal") || fallback_or_allow
  block_with "$reason"
fi

# Any other declared state (parked / error / asking / awaiting+close, plus legacy awaiting+nothing) stops.
[ "${status:-active}" != "active" ] && exit 0

if [ "$cont" = true ]; then
  # The forced continuation also stopped without declaring. Escape into asking: no default may invent a
  # completed lane, and the stopped agent now needs a human prompt to choose merge, close, ask, or park.
  # Keep this fallback inside the hook/CLI boundary.  The porcelain `session ask` command can wait on
  # delivery and workspace builds; a stop hook must settle the canonical state independently of those paths.
  $S internal session-state asking --session "$sid" --note "auto: stopped without declaring — choose merge, close, ask, or park; done --propose nothing records no state" >/dev/null 2>&1 || true
  exit 0
fi

# first stop in an undeclared state -> block. The FULL teaching text prints ONCE per session; every later
# undeclared stop gets a ONE-LINE version (a heavy session hits this gate 15-20x a night — re-printing the
# full menu each time is pure token noise). The once-sentinel is a plain file beside runtime.json in the
# session's global store dir — the same per-session-sentinel mechanism as the CLI's note-echo-taught; $sdir
# is already alias-resolved here, so a codex thread id lands on the same file, and an unwritable dir just
# teaches again (never blocks the block). The terse line must stay SELF-EXPLANATORY: an agent whose context
# was compacted may never have seen the full text, so the line carries the whole command menu, the
# declare-LAST discipline, and the `help session` entry that re-explains each choice's condition — every bit
# of the full-to-terse information gap is recoverable from the entry, none of it from memory.
taught="$sdir/stop-gate-taught"
# @@@ an artifact is a NOTE ON the demand, not a replacement for it - the artifact line used to be its own
# branch taken instead of the full menu, and the taught sentinel was stamped before it, so a session that had
# posted anything never saw the four states at all. It is also not only files: `session web add` writes
# web.json beside files.json, and checking one of them made a web-only artifact invisible here. So the
# teaching level is chosen first, and the artifact line is appended to whichever level applies.
artifact_note=""
for kind in files web; do
  store="$sdir/$kind.json"
  if [ -s "$store" ] && grep -qE '"[^"]+"' "$store"; then
    artifact_note=$(render $S internal hook-prompt stop-gate --variant artifact --cli "$S") || artifact_note=""
    break
  fi
done
if [ -f "$taught" ]; then
  reason=$(render $S internal hook-prompt stop-gate --variant terse --cli "$S") || fallback_or_allow
else
  reason=$(render $S internal hook-prompt stop-gate --variant full --cli "$S") || fallback_or_allow
  mkdir -p "$sdir" 2>/dev/null || true
  touch "$taught" 2>/dev/null || true
fi
[ -n "$artifact_note" ] && reason=$(printf '%s\n\n%s' "$reason" "$artifact_note")
block_with "$reason"
