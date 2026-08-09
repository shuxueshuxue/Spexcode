---
title: off-history-content-probe
status: active
hue: 145
desc: The plural, bounded Git seam that lets off-history eval anchors testify from exact requested content without making anchor count the process count.
code:
  - spec-eval/src/freshness.ts#contentProbeFor
  - spec-eval/src/freshness.ts#contentBatchArgs
  - spec-eval/src/freshness.ts#argvBytes
  - spec-eval/src/freshness.ts#contentBatchChunks
  - spec-eval/src/freshness.ts#parseContentBatch
  - spec-eval/src/freshness.ts#resolvedContentImages
  - spec-eval/src/freshness.ts#runContentBatch
  - spec-eval/src/freshness.ts#startPluralContentBatch
  - spec-eval/src/freshness.ts#primeAnchorTopology
related:
  - packages/l0/src/git.ts
  - spec-eval/src/evaltab.ts
  - spec-eval/src/cli.ts
  - spec-eval/src/freshness.test.ts
  - spec-eval/src/freshness-content-batch.api.test.ts
---
# off-history-content-probe

## raw source

An off-history reading is not automatically stale while its commit object still exists. Compare the exact
governed content it claims against the current tree, but do that work once for a whole eval read rather than
forking one Git process for every measurement anchor.

## expanded spec

The content fallback answers only the question [[eval-core]] asks: for each readable off-history anchor, did
each specifically requested governed path change between that anchor and the current HEAD? A whole-read caller
plans every `(anchor, paths, evalPath)` demand before asking Git. One object batch resolves the current image
and every required anchor under one coherent Git interpretation; bounded `diff-tree --stdin` chunks then
compare those exact object-id pairs with replacement lookup disabled, under the
union of only that chunk's requested literal paths, and the parser gives each anchor back only its own requested
answers. A singular caller enters the same seam with one demand.

The transport may inspect another demand's requested path while both ride one chunk, but no such extra answer
enters the memo: retained state is exactly one verdict per `(root, HEAD, anchor, requested path)`, never a
repository-wide changed-path set. An unrequested path therefore stays unprovable rather than fresh. Git's tree
identity keeps ordinary edits, mode changes, deletions, glob metacharacters, spaces, and leading colons exact.
Chunking bounds both the pair/path output cross-product and the actual pathspec argv bytes. One anchor carrying
more paths than either bound is split across children, and every child's answers remain private until every
slice succeeds, so a late failure publishes none. Anchor count never becomes child count. A demand arriving
after a chunk is drained rides the next chunk; a settled path is never asked again; abort or transport failure
settles no verdict; and independent roots never share scheduling state.

The count a drifted reading DISPLAYS obeys the same invariant. It is a reachability question, so it may not be
asked as a per-pair `rev-list --count <anchor>..<HEAD> -- <path>`: that range is off-history by construction, so
Git can never cut the walk short and every `(anchor, path)` pair traverses the whole history — measured cold on
a 437-anchor deployment scope, 1748 of the read's 1750 Git children were those counts. What HEAD's own index
genuinely cannot hold is only the ANCHORS' ancestry, and ONE `rev-list --parents` walk over the whole roster
carries it, with the roster on stdin so argv never grows with the anchor set and needs no chunking. The count is
then [[drift-by-ancestry]]'s in-memory rule read against that projection — the path's events the anchor has not
already seen — floored at one because the trees demonstrably differ. Only anchors whose governed content
actually differs need their past, so a byte-identical population walks nothing; the walk joins and re-checks
exactly like a content chunk, a rejected walk publishes nothing and every joiner sees the same failure, and an
unchanged repeat starts no child.

That projection is deliberately SEPARATE from the shared drift index rather than a graft into it. Making
off-history anchor tips reachable there would make ancestry stop answering "cannot testify" for exactly the
revisions this whole node exists to serve, silently moving the freshness DECISION from content back to
ancestry. The decision axis keeps reading the same index it always did; only the display count reads the
anchors' own walk.

Replacing the per-pair count with the ancestry rule changes displayed numbers, because the two rules were never
the same rule: a path-scoped `rev-list` counts a merge whose blob differs from both parents even when every one
of its lines was inherited from one of them, which [[drift-by-ancestry]] deliberately keeps outside a governed
path window; it cannot see events on a pre-rename lineage; its default history simplification prunes commits
the index retains; and a path whose name begins with `:` was read as pathspec magic and counted zero, surviving
only on the floor. On a 6197-commit corpus with 437 off-history anchors every displayed count moved, in both
directions, entirely within those four classes. The reading's own verdict — fresh or stale — is unaffected: it
was, and remains, the content verdict.

The interpretation identity is [[source-of-truth]]'s existing full object-format + shallow + graft +
`refs/replace` identity, not a second fingerprint. A replacement or graft move rotates the one root scope;
resolved anchor and current object ids then freeze what the children execute, so later replacement movement
cannot mix images inside one answer. `git replace --graft` is represented by its replacement commit object;
legacy graft movement still rotates the scope conservatively even though an explicit two-tree content compare
does not walk parents. Object-id validation follows the repository's native SHA-1 or SHA-256 width. A missing
object remains the explicit anchor axis but is rechecked on the next demand, so a later fetch can make it
testify without moving HEAD or adding cache state.

This is one planner over the existing per-root/per-HEAD verdict scope, not another cache, generation, timeout,
or stored freshness answer. The CLI, graph, and scoped session model all feed the same plural seam. Repeating an
unchanged read starts no content child, while moving HEAD swaps the existing scope exactly as before.
