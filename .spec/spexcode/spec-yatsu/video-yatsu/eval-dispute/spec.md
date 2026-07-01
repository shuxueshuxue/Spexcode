---
title: eval-dispute
status: pending
hue: 140
desc: A human annotation does not overrule the agent's verdict — it opens a dispute that locks the scenario until a non-trivial revision resolves it. Human review of the loss becomes binding, derived live from the append-only log.
related:
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/yatsu.ts
  - spec-yatsu/src/freshness.ts
  - spec-yatsu/src/cli.ts
---
# eval-dispute

## raw source

The agent is the evaluator: it files the `pass | fail` verdict ([[yatsu-core]]). A human watching the clip
does **not** flip that bit — flipping would conflate "the feature is broken" with "your measurement was
unsound". Instead the human opens a **dispute**, and the loss enters a state that must itself be resolved
before the agent may measure again.

## expanded spec

A dispute is an appended event of its **own kind** — a discriminated sidecar line, not a reading —
targeting the agent's reading, carrying the annotation (regions / comments, a [[video-evidence]] clip or
report blob) and a note. It puts that reading into `disputed` and **locks** the scenario. Reading-only
consumers (git-derived [[freshness]], the latest-reading pick) filter dispute lines out; only the lock
consumer reads both kinds.

Locked means: no new reading may be filed for that scenario **unless it carries `resolves: <dispute>`** —
and a scenario is locked while **any** dispute is still open, not merely the latest, so interleaved disputes
cannot bury one another. Clearing one is a **revision**: a resolving reading that must be **non-trivial** —
it advances the `codeSha` or carries a distinct evidence blob from the reading it disputes (a bare re-tag
with nothing new is refused). So the agent cannot evaporate a dispute by re-running: it must produce a
genuine new measurement, and a bad-faith revision is simply **re-disputed** — the human is the backstop.
This is what makes human review of the loss **binding**: "keep the loss honest" enforced as a gate.

Both dispute and revision are append-only events (the second git-as-database axis, [[yatsu-core]]); the
`disputed` / `locked` state is **derived live** — a scenario is locked iff some dispute has no later
matching `resolves` — exactly as freshness is derived, with no stored status. The gate lives at `spex yatsu
eval` and the stop-gate ([[yatsu-proactive]]): yatsu still runs nothing, it **refuses an action**. The
`disputed` marker is consumed **only** by this admission gate — it is invisible to loss aggregation, so it
never becomes a second verdict axis. A genuine new code version does not bury the dispute: the
world-advancing re-evaluation simply *is* the revision that carries `resolves`.

Boundary: tracking an evaluator's *accuracy over time* (a calibration leaderboard) would need a further
edge and is out of scope. A dispute is one binding request on one reading, not a standing score on the
agent.
