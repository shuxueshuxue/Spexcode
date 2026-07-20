---
title: stop-gate
surface: hook
status: active
hue: 200
events:
- Stop
order: 10
block: true
---
The blocking stop gate, with two jobs, each holding a hard loop-break so it never blocks twice on the same cause and never lets a dishonest stop through.

The COMMIT gate keeps a done/merge proposal honest: such a proposal is rejected while the branch still carries uncommitted work or is zero commits ahead of main, because the ritual commits the spec and code BEFORE proposing. Clean work is allowed to stop; a dirty proposal blocks once with the reason, and if the agent ignores it the gate escapes by downgrading to `asking` so a false "ready to merge" can never stand.

The DECLARE gate refuses to let a session stop in an undeclared `active` state, since a state is a claim the board and other agents act on, not a box ticked to end a turn. A declared state stops freely; an undeclared first stop emits `{"decision":"block"}` and the dispatcher exits 2 so the harness actually interrupts the stop and shows the reason; on the forced continuation it auto-declares a safe default — committed work becomes `awaiting`, otherwise `asking` — so the loop is guaranteed to end.

The block text is where the declaration ritual is taught, so it is written to be read at two depths. The FULL teaching text prints once per session: it names the PATH-independent CLI once as a shared prefix, lists the five choices as a compact menu each with its application condition (park policed hardest — a false park is the most damaging mislabel), and ends with the ordering discipline: declare LAST, then stop — a declaration followed by more tool calls honestly re-flips the record to active ([[mark-active]], by design), so making the declaration the turn's final call is what eliminates the park→block→re-park loop at its source. Every later undeclared stop in the same session gets a ONE-LINE version instead (a heavy session hits the gate 15-20 times a night; re-printing the full menu is token noise). The once-sentinel is a plain file beside the session record in the global store — the same per-session-sentinel mechanism as the CLI's note-truncation notice, never a second scheme. The terse line stays self-explanatory: it carries the command menu, the declare-LAST reminder, and the `spex help session` recovery entry, so an agent that never saw the full text (a compacted context) recovers every choice's condition from the entry rather than from memory — the whole full-to-terse information gap is closable from the line itself.

The clean-done eval nudge is advisory only and must never corrupt the Stop hook protocol. Claude-family hooks can receive it as `hookSpecificOutput.additionalContext`; Codex Stop allows are silent because Codex treats unsupported non-block stdout as invalid hook JSON. Blocking decisions stay shared across harnesses through `{"decision":"block"}` plus the dispatcher’s Codex stderr bridge.

Both gates act ONLY on a GOVERNED (dashboard-launched) session: the gate resolves the session's record in the global store from the payload's `session_id`, and on a non-governed (user-self-launched) record — or none — it exits 0 SILENTLY. A self-launched agent has no board to feed, so the declare-demand must never misfire on it. Its own state writes go through `spex session … --session <id>`, passing the id explicitly since there is no worktree file to read it from.

It is the enforcement edge of [[core]]: nothing leaves a session except as committed work under a truthful declaration. The freshness it reads is set by [[mark-active]].
