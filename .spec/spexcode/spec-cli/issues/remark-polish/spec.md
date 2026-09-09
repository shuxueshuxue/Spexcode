---
title: remark-polish
status: active
hue: 208
desc: The remark's three polish edges as the code now has them: a reply's `▶m:ss · <step>` anchor is parsed and resolved by one helper in Thread.jsx that no thread home feeds a step timeline, so it seeks the frozen m:ss; a remark's loop-in copy reaches the thread author only; and a scenario-keyed remark thread whose scenario has nothing behind it stays an ordinary open thread in the issue list.
related:
  - spec-dashboard/src/Thread.jsx
  - spec-cli/src/mentions.ts
  - spec-cli/src/localIssues.ts
  - spec-dashboard/src/NodeView.jsx
---
# remark-polish

Three edges of the remark track were polished after the substrate ([[remark-substrate]]) landed. Each is
described here as the code carries it now; none adds a record type or schema.

## Strand 1 — an anchor's canonical form is its step-name

A reply whose first line reads `▶m:ss · <step>` is time-anchored. `Thread.jsx` parses it (`parseAnchor`)
and resolves it through one helper, `resolveAnchor(anchor, events)`: given a step timeline, the anchor
seeks to the named step's live position and re-derives the shown `m:ss` to match, degrading to
readable-not-seekable (⚠) when the step is absent; given no timeline, the frozen `m:ss` is all there is.
No thread home passes a timeline any more — the issue detail mounts `Replies` without `events` — so every
anchor takes the no-timeline branch and the chip shows the frozen `m:ss`. The composer still stamps both
the `m:ss` and the step, so a timeline-bearing home would resolve by step again without a format change.

## Strand 2 — a notification fallback chain, never a resolve

Authoring a remark should reach someone who can act on it. The implicit loop-in ([[mentions]],
[[loop-in]]) copies a reply down a candidate chain, delivered to the first online link; for every thread —
issue-hosted or scenario-hosted — that chain is the thread's author alone (`loop-in.ts`). It is
notification only: it resolves nothing (R3: resolve is a deliberate second-party call — `spex remark
resolve`, or the dashboard's resolve — never from dispatch/delivery), never spawns a worker, and stays
silent when the author is offline.

## Strand 3 — a scenario thread with nothing behind its scenario

A remark on `<node> --scenario <name>` lands on the thread keyed `eval: <node> · <name>`
([[remark-substrate]] R4). No reading, declaration or timeline stands behind that name now, so there is no
dangling state to detect: the thread is an ordinary open local issue thread bound to its node, listed by
`spex issue ls` and the Issues page, counted in the node's open issues, and its remarks resolve and retract
through their normal `<thread-id>#<rid>` refs. The one place the key is read is the propose-close nudge,
which skips these containers because they outlive every session by design ([[local-issues]]).
