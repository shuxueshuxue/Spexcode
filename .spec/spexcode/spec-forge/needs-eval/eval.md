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
---

# measuring needs-eval

YATU through `spex issue links --pending` against real flagged issues created for the probe on the live
forge (closed/cleaned after), never by unit-calling resolveEvalPending on fixtures. The transcript walking
label form, body-line form, the non-flag trailing line, the no-route flag, and the open→closed drop IS the
reading.
