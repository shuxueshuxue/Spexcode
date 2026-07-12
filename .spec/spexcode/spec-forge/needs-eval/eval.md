---
scenarios:
  - name: flag-forms-and-open-only
    tags: [cli]
    code: spec-forge/src/needs-eval.ts
    related: [spec-forge/src/cli.ts, spec-forge/src/links.ts]
    description: >-
      Against the REAL forge, create scratch issues: one LABELED `needs-eval` with a `Spec: <real-node>`
      marker; one with a bare `needs-eval` BODY line (any indent, optional trailing colon) plus the same
      marker; one whose body line trails content (`needs-eval: foo`); one labeled but with NO node route.
      Read `spex issue links --pending [--json]` after each state, then CLOSE the first issue and re-read.
      Clean up all scratch issues.
    expected: >-
      Label and body-line forms are symmetric — both surface the issue under its marker-resolved node as
      evaluation owed (`via` preserved); the trailing-content line is NOT a flag (routing can never ride
      the predicate); a flag resolving to no node links nothing — never an invented node. Closing the
      issue drops it from the pending read (only OPEN, only flagged). The `--json` is the NodeEvalPending[]
      shape spex eval lint consumes.
  - name: pending-resolution
    tags: [cli]
    code: spec-forge/src/needs-eval.ts
    related: [spec-forge/src/cli.ts, spec-forge/src/needs-eval.test.ts]
    description: >
      Against the REAL forge: label an open issue `needs-eval` (or give it a bare `needs-eval` body
      line) with a `Spec: <node>` marker, then run `spex issue links --pending [--json]` through the
      real CLI. Also confirm a CLOSED flagged issue and a body line trailing content
      (`needs-eval: foo`) do NOT surface. Clean the label up afterwards.
    expected: >
      The flagged open issue surfaces as `node → evaluation owed` under exactly the node its marker
      (or closing `node/<id>` PR) resolves to — `--json` is the raw `NodeEvalPending[]`. The label and
      the bare body line are symmetric (either form flags); a closed issue and a trailing-content line
      are excluded. Read-only end to end: no issue is mutated by the read.
---

# measuring needs-eval

YATU through `spex issue links --pending` against real flagged issues created for the probe on the live
forge (closed/cleaned after), never by unit-calling resolveEvalPending on fixtures. The transcript walking
label form, body-line form, the non-flag trailing line, the no-route flag, and the open→closed drop IS the
reading.
