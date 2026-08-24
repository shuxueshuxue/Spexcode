#!/usr/bin/env bash
# @@@ mark-active - the SINGLE turn-boundary hook, wired to BOTH UserPromptSubmit and PreToolUse. It has ONE
# job, keyed off the session's global record dir: keep the declared FRESHNESS state honest. It carries no
# conversation — a message reaches this agent as an ordinary prompt through the harness adapter
# ([[delivery-queue]]), which is the only way anything enters a turn. A hook that also injected mail handed
# every message over twice and made the agent's context depend on which of two paths won a race.
# Freshness branches on ONE structured signal read straight from the hook payload (stdin JSON), so the state is
# HARD — never text-sniffed from the TUI:
#   the agent is pausing to ask the HUMAN (hp_is_ask) → status: asking, with the question text as the note
#                                  (the deterministic capture of a question).
#   any other tool, or a prompt submit → the agent is working → status: active (drop a now-stale proposal/note).
# WHAT counts as "asking" is the [[harness-adapter]]'s call (Claude: the AskUserQuestion tool; Codex: the
# request_user_input tool) — read via hp_is_ask, so this hook never names a harness tool.
# Fires BEFORE the tool runs, so a `spex session done` declaration (itself a tool) lands AFTER this and wins;
# the next real tool flips back to active, forcing a fresh Stop-gate declaration.
# @@@ one writer - this hook is on the hot path (every tool call), but it must not inspect session.json to
# decide whether a transition is needed. After the SQLite cutover that file is only a runtime/worktree
# envelope; using its lifecycle snapshot as a cheap cache is exactly how JSON=active and SQLite=asking drifted.
# The structured writer is idempotent for an unchanged state, so the canonical application remains the only
# lifecycle authority and the hook cannot short-circuit on a second fact. It never edits session.json itself:
# an asking note is arbitrary prose, and shell substitution is not a record writer ([[sessions-core]]).
# @@@ global store - the lifecycle state lives in the canonical session application, keyed by the harness
# session_id, grouped per-project (see hp_store_dir). The sibling session.json is only the runtime/worktree
# envelope. GATED on `governed`: a user-self-launched
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
# Managed watch deliveries are supervision messages, not work performed by this session. They arrive through
# the harness's ordinary UserPromptSubmit seam, so the freshness hook must recognize the protocol's exact
# prefix before treating that seam as a human re-entry. This is deliberately a prefix check, not a broad
# text heuristic: only the canonical `[spex watch] ` wire form is exempt; ordinary prompts and all tools still
# mark active.
if [ "$(hp_field "$payload" hook_event_name)" = "UserPromptSubmit" ]; then
  case "$(hp_field "$payload" prompt)" in
    "[spex watch] "*) exit 0 ;;
  esac
fi
sid=$(hp_session_id "$payload"); [ -n "$sid" ] || exit 0
# The canonical writer owns governed/lifecycle validation. The hook must not inspect session.json: that file is
# a runtime envelope, and using it as a gate is how old/missing envelopes silently disabled mark-active.
# The writer's stdout is a human confirmation, not hook output; stderr remains visible for real refusals.
if [ -n "$(hp_is_ask "$payload")" ]; then
  # first question's text → the note (best-effort). It is passed as ONE argv word to the writer, so quotes,
  # backslashes, newlines, and non-ASCII reach the record intact — no shell ever composes the JSON.
  ${SPEX:-spex} internal session-state asking --session "$sid" --note "$(hp_ask_note "$payload")" >/dev/null
  exit 0
fi

# Always ask the canonical lifecycle writer. It performs the semantic no-op check against SQLite; no JSON
# snapshot is allowed to decide whether this event changes state.
${SPEX:-spex} internal session-state active --session "$sid" >/dev/null
exit 0
