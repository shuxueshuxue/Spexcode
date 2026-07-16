---
title: needs-eval
status: active
hue: 280
desc: The forge half of the measurement-layer lint — recognizes OPEN issues flagged needs-eval (a label or a Spec:-style body line), resolves each to its node via the existing link sources, and exposes node → evaluation-pending. Read-only.
code:
  - spec-forge/src/needs-eval.ts#resolveEvalPending
  - spec-forge/src/needs-eval.ts#isNeedsEval
related:
  - spec-forge/src/cli.ts
---
# needs-eval

The seam where [[spec-forge]] feeds [[spec-eval]]. Read the system as one optimization: a spec is a
loss-function design, an issue/PR is the optimizer, and yatsu is the evaluator that re-reads the loss. An
OPEN issue can therefore carry one fact beyond *which node it serves* — that the node **owes a fresh
evaluation**: a fix is landing, a behavior moved, a repro wants re-reading. This node recognizes that flag
and surfaces `node → evaluation-pending`, the list the measurement-layer lint (`spex eval lint`) folds in
beside its own stale-reading findings.

**The flag — two forms, one meaning.** An issue is marked `needs-eval` by either a **label** of that
name or a **body line** that is the bare marker (case-insensitive, any indent, an optional trailing colon —
`Spec:`-styled but argument-less). The two are symmetric: a caller never learns which form a given forge
prefers. The marker is a **predicate**, not a router — it says *re-evaluate*, never *which node*. (The
label was `needs-yatsu-eval` before v0.3.0; the GitHub label was renamed via the API — a label rename
propagates server-side to every issue carrying it — while a *body-line* marker in a pre-rename issue is
archive text and simply no longer matches.)

**Which node — one resolution authority.** Routing is delegated wholesale to [[links]] (`resolveLinks`):
the issue's `Spec: <id>` marker, or transitively through a `node/<id>` PR that closes it. So there is
exactly one place a node is named, and the keystone falls out for free — a bug issue labeled
`needs-eval` plus its closing `node/<id>` PR is routed with no marker at all (`via: 'pr'`). A flag
that resolves to **no** node links nothing, the same silent drop as a typo'd `Spec:` marker — never an
invented node. A body line that trails content (`needs-eval: foo`) is intentionally **not** a flag,
so routing can never be smuggled in beside the predicate.

**Only OPEN, only flagged.** `resolveEvalPending` narrows each resolved node's issues to the **open** and
**flagged** ones: open because a closed issue's eval is no longer owed (its A→B step is already bracketed by
the closing PR — the [[spec-eval]] keystone), flagged because that is the whole signal. Each surviving
entry is the `LinkedIssue` [[links]] already produced, so it keeps `via` (marker vs the inferred PR).

**The shape, two consumers.** `NodeEvalPending[]` — the eval-pending list keyed by node — is the single
output. `spec-forge/src/needs-eval.ts` is pure and host-agnostic (it consumes whatever a driver
fetched and writes nothing), so [[spec-eval]]'s measurement lint can later import `resolveEvalPending`
directly. The [[forge-cli]] exposes the same shape on the real surface as `spex issue links --pending
[--store github] [--node <id>] [--json]` (the `--json` is exactly that list). Read-only end to end —
git/`.spec` stays the single source of truth; this never writes a node's version or status.

Out of scope (later/sibling): wiring `spex eval lint` to actually call this (a [[spec-eval]] concern),
and surfacing eval-pending in the dashboard.
