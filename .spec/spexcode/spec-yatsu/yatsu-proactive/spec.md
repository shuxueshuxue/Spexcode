---
title: yatsu-proactive
status: active
hue: 140
session: 435bdb69-6162-45e8-9f5e-853047a2247b
desc: The proactive loop that keeps the loss signal fresh — the core contract tells every agent to re-measure a node it changed, and the Stop gate surfaces a stale or missing score as a non-blocking nudge, both reusing `spex yatsu scan`.
code:
  - spec-cli/hooks/stop-gate.sh
---
# yatsu-proactive

## raw source

A score is only a useful loss signal while it is FRESH; the moment a node's code moves, its last reading is
a stale number the optimizer would read as truth. Re-measuring used to be on-demand — easy to forget, so the
signal silently rots. Make the system keep its own scores fresh: tell every agent to re-measure what it
changed, and surface a stale or missing score in the flow, not only when someone runs `scan`.

## expanded spec

Two surfaces, one engine — [[yatsu-core]]'s `spex yatsu scan`, which already lists every stale or missing
score and is scoped to the nodes that declare a yatsu.md.

The **core contract** ([[core]], folded into every launched agent) carries one line: changed a node that has
a yatsu.md? re-measure it — run its scenario, compare to the expected, file with `spex yatsu eval <node>`.
That makes re-measuring part of finishing, not a separate chore left for later.

The **Stop gate** (the stop-gate hook) adds an ADVISORY nudge — never a block. When a session stops
CLEAN-DONE (its work committed and a done/awaiting declaration made — the moment a change lands), the gate
runs scan; if any score is stale or missing it emits a non-blocking pointer to `spex yatsu eval <node>`
through the hook's additionalContext, so the agent sees it next turn. It is deliberately not a gate: a stale
score is a heads-up, not a wall, and it must never alter the commit/declare gates' stop verdict — it rides
their existing allow paths only, so a blocked stop is left untouched.

Only nodes that declare a scenario are ever in scope — a node with no surface to measure simply has no score
to go stale. Out of scope: scan's own engine and freshness derivation ([[yatsu-core]]); this node is only the
two proactive surfaces that consume it.
