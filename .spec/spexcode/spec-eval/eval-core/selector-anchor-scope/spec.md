---
title: selector-anchor-scope
status: active
hue: 155
desc: The selector-anchor probe and the per-root, current-revision scope its verdicts live in — the same current-head rule the content probe already follows, so the two sibling probes retain answers the same way instead of one re-deriving its whole corpus on every board rebuild.
code:
  - spec-eval/src/freshness.ts#anchorProbeFor
  - spec-eval/src/freshness.ts#anchorVerdictCacheSize
  - spec-eval/src/freshness.ts#entryImage
  - spec-eval/src/freshness.ts#selectorProblem
  - spec-eval/src/freshness.ts#currentTreeImage
  - spec-eval/src/freshness.ts#anchorProblems
related:
  - packages/spec-core/src/anchors.ts
  - packages/spec-core/src/git.ts
  - spec-cli/src/graphCache.ts
  - spec-eval/src/evaltab.ts
  - spec-eval/src/cli.ts
  - spec-eval/src/freshness.test.ts
---
# selector-anchor-scope

## raw source

A selector-anchor verdict — did any commit in `codeSha..HEAD` touch one of the units this reading's `code:`
entry names? — is a deterministic answer to an immutable question. It must therefore be DERIVED once and
READ back many times, not re-derived every time something unrelated makes the board rebuild.

## expanded spec

### the two sibling probes hold answers the same way

[[eval-core]]'s freshness pass runs two probes over the same read. [[off-history-content-probe]] answers
"did this governed path's content move between an unreachable anchor and HEAD"; this node answers the
spatial question [[code-anchor]] introduced, "did a commit in the window intersect one of the NAMED units".
Both are pure functions of immutable Git objects plus what the current working tree says those selectors
resolve to. So both retain their verdicts under the same rule, and neither invents a second one: **one root
owns exactly one revision's verdicts**, and a revision move swaps that root's scope wholesale.

That rule is [[source-of-truth]]'s current-root rule, the one the history and drift indices already follow.
It is the correct scope rather than a convenient one, because a checkout answers freshness questions at ONE
revision at a time: a verdict pinned to a superseded revision has no reader, and keeping it resident would
make retention grow with how many times the board has been rebuilt instead of with the corpus. Roots are
bounded by the same LRU slot count the content scope uses, because a closed worktree never asks again.

They share ONE scope object rather than keeping a parallel one, and that is the point: a head move drops both
probes' answers in the same atomic swap, and the cardinality invariant the scope exists to hold — one
retained generation, not one per rebuild — is observable for both. It needs its OWN counter beside
`freshnessCacheSize`, because a counter that reads only the content probe's entries is precisely how that
invariant came to be declared, made observable, and still violated by the sibling it could not see.

This probe enters that shared scope only when the drift index's own tip IS the current head. The index is
where its `eventsSince` windows come from, so an index built at an older tip must not be served the current
head's answers — and, the reason this is a GUARD rather than a rotation, a head that moved mid-read must not
let this probe displace the scope the content probe just settled into. Either the two agree on the head and
share one scope, or this one retains nothing and recomputes. An index that cannot name its tip likewise gets
no scope: an unnameable revision is not a cache key.

### the key names every value the verdict was derived from

Retaining a wrong answer is far worse than recomputing a right one, so the key carries every input the
derivation actually read, not a summary of them:

- the **root**, resolved, and the full Git **interpretation identity** — shallow/graft/`refs/replace`
  movement rotates what a commit id resolves to, so it rotates the scope;
- the **head**, which fixes every `eventsSince` window;
- the reading's **codeSha**, the **path**, and the **selector set** (sorted — several scenarios anchoring
  DIFFERENT units of one shared file is the whole point of the narrowing, so the set is part of the
  identity, never just the file);
- the **image of the current working-tree source** those selectors resolved against — the extractor's own
  memo key plus a digest of the exact bytes read. This is the one input that is NOT fixed by the revision:
  the working tree is dirty by construction while a session works. Never mtime or size, for the reason
  [[code-anchor]]'s parse memo already gives — a stale unit list would let a dead selector read as alive,
  which retires a reading's whole code axis in the FRESH direction;
- the **extractor registry identity**, so a host TypeScript that resolves to a different module or version
  cannot inherit the previous one's answers.

The source image is read ONCE per path per sweep and every entry on that path resolves against that one
read, so a sweep sees one coherent snapshot of the tree rather than a per-entry re-read.

### invalidation is anchored to revision, never to elapsed time

There is no TTL and there must not be one. A TTL guesses when an answer might have gone bad; the inputs
above KNOW. Every one of them is already a full-board input that [[graph-cache]] folds into its input
revision, so the scope rotates on exactly the events that can change an answer and on nothing else — which
is what makes the common rebuild (an issue, a worktree, a session moved; the revision and the sources did
not) cost nothing here. Entries are additionally bounded by a slot count and dropped wholesale on overflow,
the same bounded-slot idiom the current-tree parse memo uses, so a long editing session that keeps
re-imaging the same files at one revision cannot grow without limit.

### the full recompute is the specification

The recompute is not a fallback that may drift from the fast path — it IS the definition of the answer, and
it stays in the tree as such: a miss executes exactly the sweep that existed before any verdict was retained
(resolve the selectors against the working tree, take the `eventsSince` window, ask
[[code-anchor]]'s hit engine), and the retained path returns what that sweep returned. The binding criterion
is byte equality of the PRODUCT's answer: the board a fully-served rebuild produces must be byte-identical
to the board the same inputs produce with nothing retained. A verdict that cannot be named — no designated
extractor, an extractor that cannot run here, an unreadable or unparseable source, an anchor the ancestry
cannot testify for — is never retained and never invented; it stays the conservative no-verdict that leaves
the reading stale, and [[code-anchor]]'s loud half still names the repair.

### what this buys, and the budget that judges it

[[graph-cache]] gives a full board build a 1500 ms budget and says so out loud when it is exceeded. The
selector-anchor pass is corpus-sized work — it scales with readings × anchored `code:` entries, not with
node count — so on a self-governing corpus (241 nodes, 1850 anchored demands, 1018 distinct selector
queries) an unretained sweep costs ~840–990 ms of a ~1980 ms rebuild, and it re-paid that on every rebuild
however unrelated the trigger. Under the scope the same rebuild pays it once per revision. This is a
retention rule, not a scheduling one: it neither defers a verdict, nor widens what a verdict claims, nor
lets a caller ask for the cheap answer instead of the true one.
