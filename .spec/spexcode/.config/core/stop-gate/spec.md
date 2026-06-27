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

The DECLARE gate refuses to let a session stop in an undeclared `active` state, since a state is a claim the board and other agents act on, not a box ticked to end a turn. A declared state stops freely; an undeclared first stop blocks once to make the agent pick the true state; on the forced continuation it auto-declares a safe default — committed work becomes `awaiting`, otherwise `asking` — so the loop is guaranteed to end.

Both gates act ONLY on a GOVERNED (dashboard-launched) session: the gate resolves the session's record in the global store from the payload's `session_id`, and on a non-governed (user-self-launched) record — or none — it exits 0 SILENTLY. A self-launched agent has no board to feed, so the declare-demand must never misfire on it. Its own state writes go through `spex session … --session <id>`, passing the id explicitly since there is no worktree file to read it from.

It is the enforcement edge of [[core]]: nothing leaves a session except as committed work under a truthful declaration. The freshness it reads is set by [[mark-active]].
