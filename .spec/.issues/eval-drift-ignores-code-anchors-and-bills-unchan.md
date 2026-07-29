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

<!-- reply: c89038e2-6b56-4b4c-8b4a-4ff4ec2c886e @ 2026-07-29T12:05:42.807Z -->
CORRECTION — the title's claim is wrong, and I filed it before checking the code. eval-drift does NOT ignore
code anchors. `spec-eval/src/freshness.ts`'s `entryMoved` reads `entry.selectors` and narrows through the
same `AnchorProbe`, and both layers parse `path#symbol` through ONE shared grammar
(`spec-cli/src/anchors.ts`'s `parseCodeEntry` / `parseRelation`). A scenario CAN already carry
`code: path#symbol` today, and when it does, the narrowing works.

The real defect is narrower and lives on the SPEC side:

  spec-cli/src/specs.ts:273    const code = codeRel.entries.map((e) => e.path)

A node's `code` is flattened to base paths, dropping selectors. Live check: `drift-by-ancestry` declares
`code: spec-cli/src/git.ts#driftFor` + `#ackCoverFor`, but `spex graph --json` reports its code as
`['spec-cli/src/git.ts']`.

That matters because of the eval fallback in `spec-eval/src/evaltab.ts:187`:

  const axis = scenarioCodeAxis(sc?.code, codeFiles)

A scenario with its OWN `code:` is parsed from raw strings, so its anchors survive. A scenario that declares
none inherits the node's `code` — which has already been stripped — so it silently degrades to whole-file
drift. The degradation therefore hits exactly the nodes that DID bother to declare anchors, and only on their
un-annotated scenarios.

Measured: `drift-by-ancestry`'s four scenarios declare no `code:` of their own and were all marked stale by a
`git.ts` edit that added one import line and deleted a private helper, touching neither anchored symbol.

Two other scenarios flagged in the same run are NOT this bug and were correctly stale — they name
`spec-cli/src/git.ts` as a bare whole-file claim in their own scenario `code:`
(`source-of-truth/persistent-event-ledger-release`, `session-eval/session-scope-bounds-impact`). My original
text claimed session-eval's files were byte-identical to main; that was wrong — I had checked the NODE's
files, not the scenario's `code:` list, which explicitly includes `git.ts`.

Fix shape: carry the parsed entries (path + selectors) through the spec load so the eval fallback inherits
anchors instead of bare paths, without changing `code`'s existing bare-path shape for its many consumers
(coverage, owner lookup, graph).

Spec: source-of-truth, eval-core
