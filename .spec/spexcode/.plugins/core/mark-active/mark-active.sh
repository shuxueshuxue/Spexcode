#!/usr/bin/env bash
# @@@ mark-active - the SINGLE turn-boundary hook, wired to BOTH UserPromptSubmit and PreToolUse. It does two
# jobs, both keyed off the session's global record dir: it keeps the declared FRESHNESS state honest, and it
# delivers the session's unread MAIL.
# Freshness branches on ONE structured signal read straight from the hook payload (stdin JSON), so the state is
# HARD — never text-sniffed from the TUI:
#   the agent is pausing to ask the HUMAN (hp_is_ask) → status: asking, with the question text as the note
#                                  (the deterministic capture of a question).
#   any other tool, or a prompt submit → the agent is working → status: active (drop a now-stale proposal/note).
# WHAT counts as "asking" is the [[harness-adapter]]'s call (Claude: the AskUserQuestion tool; Codex: the
# request_user_input tool) — read via hp_is_ask, so this hook never names a harness tool.
# Fires BEFORE the tool runs, so a `spex session done` declaration (itself a tool) lands AFTER this and wins;
# the next real tool flips back to active, forcing a fresh Stop-gate declaration.
# @@@ read cheap, write through the ONE writer - this hook is on the hot path (every tool call), so it does
# its own READ in pure shell: three exact-line greps answer "already active, nothing stale to clear?", which
# is the overwhelmingly common case, and that path exits without spawning anything. When there IS a change to
# make it hands the write to `spex internal session-state`, the same structured writer the CLI declarations
# use. It never edits session.json itself: an asking note is arbitrary human/agent prose, and a writer that
# substitutes prose into existing JSON meets a quote, a backslash, or a newline and leaves a record nothing
# can parse — which is how a live session came to report "no session record" ([[sessions-core]]).
# @@@ global store - state lives NOT in the worktree but in the per-session GLOBAL record session.json, keyed
# by the harness session_id, grouped per-project (see hp_store_dir). GATED on `governed`: a user-self-launched
# (non-governed) session has no board to feed, so this no-ops on it. cwd = the session worktree.
. "${SPEXCODE_HARNESS_LIB:?harness.sh not exported by dispatch.sh}"
payload=$(cat 2>/dev/null)
# an IN-PROCESS SUBAGENT's tool call (Claude's Task tool) fires the parent's hooks with the PARENT's
# session_id — flipping here let a supervising parent's own subagents erase its declared park/ask within
# seconds and race the stop-gate into "undeclared stop" (issue #60). A subagent working is not the parent
# agent ACTING, so its calls never touch the record; the parent's own next tool call still flips. The
# discriminator is the payload's own top-level agent_id stamp (hp_is_subagent) — deterministic, never a
# timing window.
[ -n "$(hp_is_subagent "$payload")" ] && exit 0
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
sdir=$(hp_store_dir "$sid") || exit 0
rec="$sdir/session.json"
# board-lifecycle gate: only a GOVERNED (dashboard-launched) session has a board state to maintain.
grep -q '^[[:space:]]*"governed"[[:space:]]*:[[:space:]]*true,\?$' "$rec" 2>/dev/null || exit 0

# @@@ the mail read - this hook is the ONE reader of the session's inbox ([[session-timeline]]): a message is
# delivered by being appended to timeline.ndjson, and the agent finds it here, by mechanism, at a turn
# boundary — never by remembering to run a command. `cursors.json` names how far this session has been shown
# ([[session-cursors]]); everything past it is unread, the `sent` lines among it are printed as context, and
# the cursor advances past ALL of it (a session's own status lines are not mail, but they are consumed, so
# they can never come back as one).
# Pure bash builtins, no forks: the common case is "no new lines", and the fast path must not cost a spawn.
# The read is generous where it cannot be exact — an unparseable cursor reads as 0, which re-shows a message
# rather than skipping one.
mail() {
  local tl="$sdir/timeline.ndjson" cur="$sdir/cursors.json" pos=0 i=0 line body unread=""
  [ -f "$tl" ] || return 0
  if [ -f "$cur" ]; then
    while IFS= read -r line; do
      case "$line" in
        *'"inbox":'*) line="${line#*\"inbox\":}"; line="${line%%,*}"; line="${line// /}"; line="${line//$'\t'/}"
                      case "$line" in ''|*[!0-9]*) ;; *) pos=$line ;; esac; break ;;
      esac
    done < "$cur"
  fi
  while IFS= read -r line; do
    if [ "$i" -ge "$pos" ]; then
      case "$line" in
        *'"kind":"sent"'*) body=$(hp_field "$line" text)
                           [ -n "$body" ] && unread="$unread$body"$'\n\n' ;;
      esac
    fi
    i=$((i + 1))
  done < "$tl"
  # No mail → no cursor write. Unread STATUS lines alone leave the cursor where it is: they print nothing, so
  # advancing past them would buy nothing and cost a spawn on almost every turn. The next scan re-reads them
  # and still prints nothing.
  [ -n "$unread" ] || return 0
  printf 'Messages addressed to you (delivered to your session log while you were working):\n\n%s' "$unread"
  ${SPEX:-spex} internal session-cursor inbox --session "$sid" --to "$i" >/dev/null 2>&1
}
mail

# does FIELD's line hold exactly VALUE? The record is written one-field-per-line by the single writer
# (sessions.ts writeRecord), so a whole-line match is exact — and, unlike a value regex, it cannot be fooled
# by an escaped quote inside a neighbouring note.
jline_is() { grep -q "^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"$2\",\?$" "$rec" 2>/dev/null; }

# The writer's own stdout is a human confirmation, not hook output — swallow it so a PreToolUse handler never
# emits a decision-shaped line; its stderr (a refusal — a corrupt or retired record) still surfaces. We always
# exit 0: this hook observes freshness, it is not a gate on the tool that triggered it.
if [ -n "$(hp_is_ask "$payload")" ]; then
  # first question's text → the note (best-effort). It is passed as ONE argv word to the writer, so quotes,
  # backslashes, newlines, and non-ASCII reach the record intact — no shell ever composes the JSON.
  ${SPEX:-spex} internal session-state asking --session "$sid" --note "$(hp_ask_note "$payload")" >/dev/null
  exit 0
fi

# cheap path: already active with nothing stale to clear → no-op (the common every-tool case), no spawn.
jline_is status active && jline_is proposal '' && jline_is note '' && exit 0
${SPEX:-spex} internal session-state active --session "$sid" >/dev/null
exit 0
