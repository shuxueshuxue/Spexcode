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

`evidence/v1-delete/counterexamples.txt` is the same treatment for every stub. `stubs/run.mjs`
refuses to count a stub that fails to load: a module error is reported as
`HARNESS FAILURE, not a counter-example` and the run exits non-zero, so "did not measure" can never
be mistaken for "measured and fine".
