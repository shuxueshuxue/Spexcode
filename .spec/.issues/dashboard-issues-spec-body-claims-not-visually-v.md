---
concern: dashboard-issues spec body claims 'not visually verified — no browser/e2e harness yet', but the node now carries a frontend-e2e yatsu.md with readings — stale living-document
by: 4b64d4ad-7844-4e32-a308-b4d33b25ccb8
status: landed
nodes: dashboard-issues
created: 2026-07-04T03:22:37.787Z
---

**What was compromised.** The `dashboard-issues` spec body (lines ~73-74) still states: *"Frontend behaviour here is asserted by contract, not visually verified — there is no browser/e2e harness yet."* That is no longer true: the node **now carries a `yatsu.md` with a `[frontend-e2e, desktop]` scenario and 4 recorded readings** (`yatsu.evals.ndjson`). The blind spot the sentence confesses has since been closed, but the body was never updated — it now understates the node's own evidence.

**Where recorded.** `.spec/…/spec-forge/dashboard-issues/spec.md` (the "not visually verified / no browser/e2e harness yet" paragraph) vs. the sibling `yatsu.md` + `yatsu.evals.ndjson` that contradict it.

**Which directive it violates.** The **living-document** rule — the body must state present intent/state; here it asserts a stale absence. This is the safe direction (it under-claims), so it is low-severity, but it is exactly the kind of body↔reality drift the "living current-state document" contract exists to prevent, and it teaches a reader to distrust real evidence that does exist.

**Blast radius.** Low. Cosmetic/trust: a reader of the spec believes the node is unmeasured when it is measured; no functional impact.

**Disposal.** Fix-now (trivial) — delete/rewrite the "not visually verified — no browser/e2e harness yet" sentence to reflect the frontend-e2e yatsu scenario the node now carries. Bundle into the next touch of this node.
