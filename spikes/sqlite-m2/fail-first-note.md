# What each failure log proves

Every failure log here is kept verbatim. None has been edited, regenerated in place, or overwritten
by a later run. The WAL-era logs are retained deliberately: they are the evidence the human ruling
was made on, even though v1 no longer uses WAL.

## Historical, WAL era — `fail-first.log`

The first failure recorded on this lane, `ERR_MODULE_NOT_FOUND` for `engine.mjs`, produced before the
engine existed:

```
cd spikes/sqlite-m2 && node --test test/engine.test.mjs     # with engine.mjs absent
```

Retained because it is the original artefact. It is **not** fail-first evidence for any frozen
decision: a missing module fails identically whether the eventual implementation is right or wrong,
so it discriminates nothing. It records only that the vectors were written before the engine.

## Historical, WAL era — `evidence/fail-first-discriminating.log`, `evidence/counterexamples.txt`

Real counter-examples, but measured when v1 was still specified as WAL. Their numbers and some of
their flips no longer describe v1. Kept as the record of that period.

## Current, v1 rollback journal — `evidence/v1-delete/`

```
cd spikes/sqlite-m2
node stubs/build.mjs
M2_ENGINE=../stubs/converts-wal-instead-of-refusing.mjs node --test test/engine.test.mjs
node stubs/run.mjs
```

`evidence/v1-delete/fail-first-discriminating.log` is that first command's output: the vectors,
unchanged, against an engine that converts a WAL database instead of refusing it. It fails on
`a database left in WAL is refused, not converted` — our own assertion, naming the violated claim.

### The two counter-example matrices

`evidence/v1-delete/counterexamples.txt` is the **superseded** record. It reports `9/9 gated`, and
that claim did not hold: the `busy-timeout-after-version-probe` flip was gated only by a
probabilistic cold-open race that caught it in 8 of 12 runs, so two honest runs of identical code
could and did disagree. Kept verbatim, because the mistake is part of the record.

`evidence/v1-delete/counterexamples-gated.txt` is the **current** record: `gated 10/10, ungated 0,
not measured 0`, after the ordering decision got a deterministic gate
(`busy-timeout-gate-stability.txt`).

`stubs/run.mjs` now reports three states rather than two — GATED, UNGATED, NOT MEASURED — because
`vectors that fired: 0` used to mean either "nothing caught it" or "we never got a verdict", and
those demand opposite responses. A stub that fails to load, a run that times out, and a flip caught
only intermittently are all NOT MEASURED, and none of them counts as evidence that a decision is
fine. `evidence/v1-delete/tri-state-demo.txt` exercises all three states against one vector.
