---
title: review acceptance
status: active
hue: 280
desc: A merge-review declaration proves the candidate's whole configured suite against a repeated main baseline and reports only attributable loss.
code:
  - spec-cli/src/review-acceptance.ts
related:
  - spec-cli/src/session-declarations.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/guide.ts
  - spec-cli/src/help.ts
  - spec-cli/src/hook-prompts.ts
  - packages/spec-core/src/layout.ts
  - package.json
  - spexcode.json
  - spec-cli/src/review-acceptance.test.ts
  - spec-cli/src/session-merge-dispatch.api.test.ts
  - spec-cli/src/session-record-integrity.test.ts
  - spec-cli/test/session-record-integrity-fixture.ts
---

# review acceptance

## raw source

`done --propose merge` is a claim about what the candidate changed, not a claim that some absolute number of
tests happened to pass. Before SpexCode records review, it runs the project's complete configured acceptance
suite on the candidate and on the source-of-truth branch, then reports the failures attributable only to the
candidate. A non-empty attributable difference refuses review. `ask`, `park`, and close-pending declarations
remain available because reporting or waiting on a failed gate is not a claim that the work can merge.

## expanded spec

The project declares one ordered review suite in committed `spexcode.json`: a preparation command, one or more
named commands, and a repeat count of at least two. Type checking is one command in that same suite, not an
optional parallel ritual. The repository's root `package.json` exposes `typecheck`, so both a person and the
automatic gate execute the same type-contract check. A project with no review suite keeps the legacy declaration
path without appending a synthetic acceptance summary to the worker's note; once the project opts in,
`done --propose merge` is the non-optional caller and no worker must remember a second command.

The cost and variance are measured facts, not hypothetical optimization pressure. On this repository the
`spec-cli` suite took about **270 seconds for one run**. On the same `main` code, separate single runs observed
**3 failures and 8 failures**. Therefore one green run is only one run, and one main run is not an adequate
baseline: both candidate and main run at least twice, every report states the run counts, and comparison uses
the union of failures observed across those runs. This is why the main result may be cached and why a cache entry
must retain its run count; a one-run entry is explicitly low confidence whenever read.

Each run uses a fresh detached checkout of the exact commit plus the configured preparation command. This keeps
the compared source, workspace links, generated build inputs, and dirty state from leaking across candidate,
main, or repeat runs. A command emits TAP for named tests; a non-zero command with no named TAP failure becomes a
named command failure, so typecheck, setup, a crash, or an unsupported reporter cannot disappear behind an empty
set. The gate stores the raw run logs outside the product repository and binds each cached run to its content
hash.

Main results are cached in the project-global runtime store by the exact main SHA, suite configuration, and
runtime fingerprint. A cache miss runs main with the same repeat count as the candidate. A hit never impersonates
a fresh run: the declaration note says it was cached and names the SHA, collection timestamp, run count, and
whether that count is low confidence. Candidate results are always collected for the current declaration and
also state their run count. A malformed entry, mismatched fingerprint, or missing/hash-mismatched raw log is a
cache miss, never a trusted partial baseline.
The candidate and main refs are re-read after collection; if either moved, the declaration refuses rather than
attaching a fresh-looking verdict to a different generation.

Known instability is committed policy because it changes the attribution result, and is treated as an abuse
surface. Every entry names one exact test and carries paired pass/fail observations with full commit SHA,
timestamps, and a durable source reference; missing evidence makes configuration invalid rather than granting an
exemption. An exemption expires at the earlier of its configured wall-clock age or number of subsequent main
baseline collections without another observed pass/fail flip. A later multi-run baseline flip is itself recorded
with SHA, collection time, run count, and hashed logs, and resets both expiry clocks. While active it subtracts that test only from the candidate-only failure set. The report
prints the entire committed registry on every declaration: an entry is visibly `APPLIED`, `NOT NEEDED`, or
`NOT APPLIED`, with its evidence and expiry state. An expired or invalid entry subtracts nothing and is printed
as requiring renewed evidence. The registry is review-before policy, not a candidate escape hatch: an entry must
already be committed and evidenced independently of the candidate declaration, and the worker whose candidate
would benefit from the subtraction must not create, edit, or self-approve that entry. A worker may report a
suspected instability, but only a later independent observation and owner can add or renew the exemption. The
recent 19-test rerun is deliberately only an observation: `18/19` once and an isolated `1/1` pass did not enter
the registry because the affected worker was the observer. Thus the list can explain noise but cannot silently
erase it or become a self-issued license.

The declaration note contains the complete acceptance summary: candidate SHA and runs, main SHA and runs, fresh
versus cached provenance, candidate-only failures, and every registered flaky entry. If attributable
failures remain, no `awaiting/merge` state is written and the output directs the worker to fix them or use `ask`
to hand the finding upward. Other lifecycle declarations never invoke this gate.
