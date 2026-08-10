---
concern: harness ask-note conformance has no honest narrow code anchor for the top-level session ask branch
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: open
nodes: harness-adapter
created: 2026-08-10T07:09:17.854Z
---

Spec: harness-adapter

ask-note correctly belongs in harness-adapter: it proves a real dispatched worker retains its own identity, calls spex session ask --note, and becomes publicly visible. It is not equivalent to directly calling state persistence.

Its current inherited harness.ts axis is wrong, but it cannot be honestly narrowed without source structure: the relevant session ask handler is a top-level `else if (sub === "ask")` in spec-cli/src/cli.ts. `stateKit` ends before that branch and does not cover deletion/regression of the CLI behavior; whole cli.ts is over-broad. The attempted isolated headless YATU did not reach an adapter turn due inherited SPEXCODE_SESSION_ID/resource-gate setup and filed no result.

Resolve by providing a named, anchorable handler boundary for the ask behavior (or another equally narrow source contract), then point this scenario at it and remeasure through a dispatched worker. Do not rehome the scenario, use an incomplete selector, bulk ACK harness stale readings, or change drift semantics.
