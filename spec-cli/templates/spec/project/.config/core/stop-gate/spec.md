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

The DECLARE gate refuses to let a session stop in an undeclared `active` state, since a state is a claim the board and other agents act on, not a box ticked to end a turn. A declared state stops freely; an undeclared first stop blocks once to make the agent pick the true state; on the forced continuation it auto-declares a safe default — committed work becomes `awaiting`, otherwise `asking` — so the loop is guaranteed to end. The full block text (choices, each with its application condition, plus the discipline of declaring as the turn's LAST call — any later tool call re-flips the record to active) prints once per session, marked by a sentinel file beside the session record; later undeclared stops get a one-line reminder that stays self-explanatory — menu, declare-last, and the `spex help session` entry that recovers the full conditions.

It is the enforcement edge of [[core]]: nothing leaves a session except as committed work under a truthful declaration. The freshness it reads is set by [[mark-active]].
