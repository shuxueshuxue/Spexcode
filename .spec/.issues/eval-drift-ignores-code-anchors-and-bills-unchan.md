---
concern: eval-drift ignores code anchors and bills unchanged nodes
by: c89038e2-6b56-4b4c-8b4a-4ff4ec2c886e
status: open
created: 2026-07-29T11:55:47.225Z
---

`spex eval lint` reports eval-drift at WHOLE-FILE granularity, while the spec layer resolves drift against
the `code:` **anchors** (`path#symbol`). The two layers therefore disagree about what "this scenario's code
moved" means, and the eval layer over-reports — which is one mechanism by which stale readings accumulate
faster than anyone can re-measure them (currently 434 on main).

Measured on branch `node/https-bj01-ezfrp-com-20703-p-home-jeffry-spexc-c890`, whose only change to
`spec-cli/src/git.ts` is +1 import line and −4 lines deleting a private `processAlive` helper (an exact
duplicate of the one now exported from `process-identity.ts`):

- `drift-by-ancestry` anchors `spec-cli/src/git.ts#driftFor` and `#ackCoverFor`. NEITHER symbol was
  touched, yet all four of its scenarios are reported stale.
- `source-of-truth` anchors `spec-cli/src/specs.ts#loadSpecs`, which is byte-identical to main; `git.ts` is
  only a `related:` edge, yet `persistent-event-ledger-release` is reported stale — and that scenario is a
  pinned-corpus benchmark (cold-seed / same-tip / advancing-tip, wall+CPU+RSS+ledger accounting), i.e. one
  of the most expensive things in the repo to re-measure.
- Worst case, `session-eval`'s `session-scope-bounds-impact` is reported stale although EVERY file it
  governs or relates to (`spec-eval/src/sessioneval.ts`, `spec-cli/src/{index,cli,client}.ts`) is
  byte-identical to main. Nothing it measures changed at all.

Evidence the branch is behaviour-preserving for the flagged path: `spex spec lint` run from cold
`SPEXCODE_HOME`s on the same repository, once with this branch's toolchain and once with main's, produces
BYTE-IDENTICAL output (the event-ledger/lock path is exercised fresh in both).

Effect: a mechanical dedup in a large shared file bills a heavy benchmark plus three unrelated nodes for
re-measurement. That is a strong incentive not to clean up shared files, and it is what the `code:#symbol`
anchor was introduced to prevent on the spec side. The eval layer should resolve drift through the same
anchors, and a node whose governed and related files are all unchanged should never be reported stale.

Spec: eval-core, drift-by-ancestry
