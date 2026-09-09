---
title: remark-teeth
status: active
hue: 205
desc: What an unresolved remark costs now: its thread stays open, and nothing more — no reading exists for it to age, and drift is the only staleness signal. The resolved bit and its instant ride the reply, move the board's thread stamp (issues.ts), and are read by no freshness computation; a scenario-keyed thread folds into its node's issue counts like any other (graph.ts).
code:
related:
  - spec-cli/src/issues.ts
  - packages/spec-core/src/graph.ts
---
# remark-teeth

The [[remark-substrate]] built the substrate: a remark is a reply carrying a resolvable bit and the
targetSha it was authored against. This node states what that bit is worth once written, as the code has
it now.

## what an unresolved remark costs

Its thread stays open, and nothing more. A scenario-keyed thread (`eval: <node> · <scenario>`) has no
reading behind it: nothing measures the scenario, so there is nothing for the remark to age, and drift — a
governed file moving past its spec — is the only staleness signal the graph carries. No freshness
computation reads `resolved` or `resolvedAt`; `spex issue show <id>` and the dashboard's thread render them
as the remark's state, and that is where they end.

## what the bit does move

Two things read the remark fields, and both are about visibility rather than loss:

- `threadStamp` (`issues.ts`) folds every reply's `at` and `resolvedAt` into the board's one thread stamp,
  so a resolve or retract moves board bytes and reaches an open viewer like any other thread write
  ([[remark-substrate]] write-visibility).
- The per-node fold (`graph.ts`) counts a scenario-keyed thread in its node's open/closed issue counts like
  any other thread bound to that node; there is no scenario join, no overlay onto a reading, and no second
  read that keeps those threads apart ([[issue-remark-split]]).

Resolve stays a deliberate second-party call ([[remark-substrate]]'s R3: never the author, monotonic), on
the CLI or the dashboard alike; nothing resolves a remark as a side effect of dispatch or delivery.
