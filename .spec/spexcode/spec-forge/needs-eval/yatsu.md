---
scenarios:
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

Measured YATU through `spex issue links --pending` against a real forge issue — the fixture-driven unit
suite (needs-eval.test.ts) is auxiliary evidence, not the product reading.
