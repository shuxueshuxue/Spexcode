---
title: drift-gate
status: active
hue: 175
desc: Drift as a forcing function — diagnose where the chain of truth broke, gate commits locally, never patch.
code:
  - spec-cli/src/drift.ts
---
# drift-gate

## raw source

Drift had become noise: most of the lint was drift warnings, real lag inflated by hub files many specs
share, by specs over-claiming files they don't really own, and by an acknowledgement trailer almost
nobody used. The fix is not to silence drift but to make it *mean* something: treat a drift signal as a
**checkpoint that forces a diagnosis**, not a chore to dismiss.

A governed file moving ahead of its spec can be a defect anywhere along the chain of truth —
raw intent → expanded spec → `code:` link → code structure → implementation. The agent's job at the
checkpoint is to find *which* link broke and fix *that* one. Never patch the symptom — a blind ack or a
cosmetic spec edit — just to get past the gate.

To keep the hard gate rare and fair, it fires only on commits that touch an already badly-drifted node,
never retroactively on the backlog; everyday small drift only nudges.

## expanded spec

**Diagnose — `spex drift [node] [--explain]`** (a report, never a gate). Lists every drifting node with
its total and, per file, the *other* nodes that also govern it — a high fan-out is itself the
structural-mismatch smell. `--explain` adds the three layers side by side so the broken link is visible:
the **raw source**, the **expanded spec**, and the **code diff since the spec's last version**.

**The remedies (DRIFT_GUIDANCE)** — printed by the gate and the report. Each drift case has one honest
fix: *contract changed* → re-version the body; *only mechanics* → a reasoned `Spec-OK` ack; *implementation
is wrong* → fix the code back toward the spec; *wrong link* → correct the `code:` frontmatter; *expanded
spec ≠ raw* → realign the expanded spec to human intent; *structural mismatch* → refactor so a file maps
to a node, or file and link an issue. The principle that governs all of them: **never patch** — a reasoned
ack or a real fix are recorded and re-judged at review; a blind ack is a lie on the record.

**Gate — `spex lint --gate`**, run from the pre-commit hook. It blocks a commit only when one of *its own
staged files* belongs to a node already `≥ driftErrorThreshold` commits behind — "reconcile this node
before piling more change onto its files." Sub-threshold drift on a touched node prints the guidance but
does not block; drift on nodes this commit doesn't touch never blocks. So the gate is **commit-local**,
not a tax on the existing backlog.

Plain `spex lint` (and therefore CI — see [[ci-gate]]) keeps drift **advisory**: the hard drift block is
local-only, by design. The threshold is `lint.driftErrorThreshold` in `spexcode.json` (default 3), owned
with the rest of the lint config and the `Spec-OK` acknowledgement mechanism by [[spec-lint]]; acked
churn is suppressed before it ever reaches this gate.
