---
title: yatsu-proactive
status: active
hue: 140
session: 435bdb69-6162-45e8-9f5e-853047a2247b
desc: The proactive loop that keeps the loss signal fresh AND covered — the core contract tells every agent to measure what it changed, and the Stop gate, scoped to that agent's own changed nodes, nudges once on a stale score or an uncovered frontend node, and '推一把' points at RUNNING the real e2e pass when the stale scenario is browser-measured. Both reuse `spex yatsu scan --changed`.
related:
  - .spec/spexcode/.config/core/stop-gate/stop-gate.sh
---
# yatsu-proactive

## raw source

A loss signal is only useful while it is FRESH and COVERED: a node's reading goes stale the moment its code
moves, and a frontend node with no yatsu.md has no signal at all. Both rot silently when measuring is
on-demand. Make the system keep its own scores honest — tell every agent to measure what it changed, and
surface the gap in the flow. But surface only the agent's OWN gaps: nagging it about a score that went stale
in a node it never opened is noise it rightly ignores (three workers in a row asked "is this mine?").

## expanded spec

Two surfaces, one engine — [[yatsu-core]]'s **`spex yatsu scan --changed`**, scoped to the nodes the
current branch touched (vs its fork-point from the main branch), reporting three gap classes: `yatsu-drift`
/ `yatsu-missing` (a node with a yatsu.md whose score is stale / unmeasured) and `yatsu-uncovered` (a
frontend node carrying no yatsu.md).

The **core contract** ([[core]], folded into every launched agent) carries the rule: changed a node with a
yatsu.md? re-measure it. Made an obvious frontend change to a node with none? give it one. That makes
measuring part of finishing, not a chore left for later.

The **Stop gate** (the stop-gate hook) adds the nudge. When a session stops CLEAN-DONE (its work committed
and a done/awaiting declaration made — the moment a change lands), the gate runs `scan --changed` and, if a
gap touches what the agent changed, emits a pointer through the hook's additionalContext: re-measure a stale
score, or give an uncovered frontend node a scenario. It is **not a gate** — a gap is a heads-up, not a
wall, and it never alters the commit/declare gates' stop verdict, riding their allow paths only.

**'推一把' — the e2e case.** A browser-measured scenario rots differently from the rest: refreshing it means
actually DRIVING the running product, which an agent will skip at the finish line unless pushed there. So the
Stop nudge NARROWS: when a stale/unmeasured gap sits on a scenario tagged **browser-measured** (the
drive-a-real-browser surface tag from [[yatsu-core]]'s `lint.scenarioTags` — `scan --changed` now carries
each drift/missing scenario's tags on its finding line, so the gate spots the surface), the same
additionalContext gains a second pointer: RUN the e2e pass yourself — drive the product, capture the reading,
file it with `spex yatsu eval` — *before* calling the work done. It is a pointer to PRODUCE the measurement,
never to review a recording after the fact (that is the separate e2e-review command). The narrowing is exact:
only a browser-tagged **drift/missing** gap triggers it — a backend/CLI gap never does, and an uncovered node
carries no scenario to run yet, so it stays the generic "give it one" nudge. Still one emit on the same allow
path, never a block: a blocking e2e gate would wall an honest stop, which is over-guiding, not '推一把'.

It **fires once.** The additionalContext itself forces one continuation, so the gate guards the nudge on
`stop_hook_active` — re-emitting on that forced re-stop is exactly what looped 31 turns and tripped the
Stop-hook block cap. Nudge on the first natural stop; stay silent on the continuation; let the agent stop.

Out of scope: scan's own engine, freshness derivation, and the changed-node / frontend-surface
classification ([[yatsu-core]]); this node is only the two proactive surfaces that consume it.
