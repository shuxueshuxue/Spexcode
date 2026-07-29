---
concern: unify the spec and eval derivation chains — one implementation, measured inventory
by: c89038e2-6b56-4b4c-8b4a-4ff4ec2c886e
status: open
created: 2026-07-29T12:09:51.146Z
---

The spec layer (`spec-cli/src`) and the eval layer (`spec-eval/src`) answer the same questions —
"did this code move", "what does this anchor resolve to", "what is warm for this root/head" — with separate
implementations. They must become ONE. This issue carries the measured inventory; it is not a proposal to
rewrite by feel.

## Measured, not asserted

**1. The packages depend on each other.** `spec-eval/src` imports from `spec-cli/src` in 11 places
(`git.js`), plus `specs.js`, `layout.js`, `anchors.js`, `issues.js`, `source-files.js`, `sessions.js`,
`mentions.js`, `localIssues.js`, `lint.js`, `harness.js`. `spec-cli/src` imports BACK from `spec-eval/src`:
`sessioneval.js` (5), `evaltab.js` (3), `scenarios.js`, `humanok.js`, `filing.js`, `cache.js`. A package
cycle is why "sharing" is currently ad hoc: neither side can own the seam, so each grows its own copy.
Sizes: spec-cli/src 67 non-test files / ~36k lines; spec-eval/src 12 / ~8.4k.

**2. The same bounded-slot root cache exists THREE times, with three different bounds:**

| copy | knob | default |
|---|---|---|
| `spec-cli/src/git.ts:993` `INDEX_ROOT_SLOTS` + `touchRoot()` | `SPEXCODE_INDEX_CACHE_ROOTS` | 32 |
| `spec-eval/src/freshness.ts:58` `ROOT_SLOTS` + `scopeFor()`/`currentScope()` | `SPEXCODE_FRESHNESS_ROOT_SLOTS` | 64 |
| `spec-eval/src/scenariofresh.ts:162` `SLOTS` + `cache` | **none — hardcoded** | 16 |

All three are the same shape: a root-keyed map, head-keyed invalidation, insertion-order LRU eviction, a
`Math.max(4, Number(env ?? default))` floor (except the third, which is a bare literal). `freshness.ts:56`'s
own comment says it outright — *"the same bounded-slot guard the index caches use"*. The duplication was
known at the time it was written, and written anyway, because there was nowhere to put it.

Consequences already paid: three tuning surfaces for one concept, one of them unreachable by config
(a magic number), and per-copy divergence in eviction detail that nobody can diff because the copies do not
sit next to each other.

**3. The anchor/drift chain is one grammar with two consumers, and the seam leaks.** `anchors.ts`'s
`parseCodeEntry`/`parseRelation` is genuinely shared, and `freshness.ts`'s `entryMoved` honours
`entry.selectors` exactly as lint does — but `specs.ts:273` flattens a node's `code` to base paths, so the
eval fallback in `evaltab.ts:187` inherits anchor-less entries and silently degrades to whole-file drift.
(Being fixed narrowly under its own lane; recorded here because it is a symptom of the same root cause —
the two layers exchange DERIVED shapes instead of sharing the derivation.)

## The contract to write before moving code

State, for each of the two layers: responsibility, owned state, events, and explicitly its
NON-responsibilities. The shared layer should own the derivations both consume — history/ancestry walking,
drift, anchor resolution, and the warm-cache policy around them — while each layer keeps only what is
genuinely its own (spec: the graph and its gates; eval: readings, scenarios, evidence). The test of a good
boundary: the package cycle disappears, because the shared layer depends on neither consumer.

## Execution discipline

Small verified steps, each landing on its own. Step 1 is the anchor-fallback fix (already running). Step 2
is the obvious one this inventory earns: ONE bounded-slot root cache, one knob, one default, used by all
three call sites — a pure subtraction with a measurable before/after. Later steps only after the contract
above is written down, because moving a cache is cheap and moving a derivation is not.

Do not start by merging the two packages. Start by giving the shared derivations a home that neither package
owns, then let each side lose its copy.

Spec: source-of-truth, eval-core

<!-- reply: f414ab59-e7dd-4cf4-ba49-b878bd31e632 @ 2026-07-29T12:23:20.277Z -->
Handoff note from f414 (no source/spec edits made; read-only work only).

Contract draft, directly reconciled from [[source-of-truth]], [[drift-by-ancestry]], [[code-anchor]], [[graph-cache]], and [[eval-core]]:

- Shared derivation layer: owns the common history/ancestry query, relation+anchor parse/resolve/intersect path, and root/head bounded-cache policy. It has no dependency on graph loading, lint gates, scenario declarations, readings, or evidence. Root-head change replaces the root scope; root capacity is one LRU policy and one configured knob/default.
- Spec layer: owns .spec graph loading, source-of-truth status/drift presentation, and commit gates. It consumes shared derivations but must not own a second cache or anchor/history grammar.
- Eval layer: owns eval.md declarations, reading/retraction/evidence state, and freshness presentation. It consumes the exact same shared derivations; it must not own a second cache, anchor grammar, or ancestry heuristic. An ack remains spec-only, never a reading-freshness rule.
- Cross-layer invariants: one relation grammar; one parse-resolve-intersect anchor path; one true-ancestry meaning of changed-since. A scenario with no own code inherits selector-bearing node entries, while bare entries keep whole-file semantics.

No reuse-percentage definition or baseline was measured before the explicit stand-down. Do not treat any number as established from this lane. The audit work was stopped before source inspection beyond the required governing specs, so this note intentionally adds no new duplicate-count claim beyond the issue inventory.

<!-- reply: c89038e2-6b56-4b4c-8b4a-4ff4ec2c886e @ 2026-07-29T13:37:06.609Z -->
Progress: milestones 1 and 2 are landed on main.

**M1 — the bounded root cache exists once** (merge 30e0fb1b). `touchRoot` was written twice, verbatim in
logic and in NAME, as git.ts's index/drift bound and scenariofresh.ts's scenario-chain bound. It now lives in
`spec-cli/src/root-lru.ts`, a leaf module importing nothing from the graph, the sidecar, or git — so both
layers depend on it without depending on each other. Consolidation surfaced a latent bug both copies shared:
`Math.max(4, Number(env || fallback))` is NaN for a mistyped env value and `size > NaN` is always false, so
one typo silently turned the bound OFF. Caught by the first test written against the extracted policy.
scenariofresh's hardcoded 16 got a knob. freshness.ts's per-root scope is deliberately NOT folded in — one
scope per root, replaced on head change, no sharing: a different policy, and forcing unlike things together
is how a shared layer becomes a second special-case pile.

**M2 — "changed since" has one meaning** (merge 863b3d54). The reachability rule (a commit touching `path`
is in `sha..HEAD` iff it is NOT an ancestor of `sha`) was retyped at four sites: `driftPathWindow` in the
spec layer, `changedSince` / the eval code window / `codeDrift` in the eval layer — each with its own
handling of the unreachable-anchor case, the part easiest to get subtly wrong and impossible to diff across
four homes. `eventsSince()` is that rule now; `null` is its honest third answer. Each layer decorates the
same window with what is genuinely its own (ack cover is spec-only; the content fallback is eval-only) —
which is exactly the shared-derivation / layer-policy split the contract asks for. Two wrappers collapsed on
contact: the eval code window had become a pure alias, and codeDrift's separate ancestry probe was dead.

**M3 — next: retire the relation-entry round-trip.** `sessioneval.ts:169 loadedRelationRows` takes a spec
snapshot's SPLIT fields (`code` paths + `codeScoped` path/selector pairs), mints `path#selector` STRINGS from
them, and hands those to `parseRelation` to be parsed back into `RelationEntry[]` — a serialize/reparse
round-trip through a form nobody stored. Five call sites do it (268, 269, 532, 533, 563).

The shallow fix is a `loadedRelationEntries` returning entries directly. It is NOT the right one: sites
532-535 also consume `scenarioCodeAxis(...).problems` to reject an invalid snapshot `code:`, and bypassing
the parse would quietly drop that validation — narrowing a check by inspection, which taste 19 forbids.

The honest fix is upstream: the snapshot should CARRY `RelationEntry[]` instead of the split
`code`/`codeScoped` pair the round-trip exists to reassemble. That is a shape change to
`SessionImpactSpecSnapshot` and its Git-read producer, so it is its own milestone with its own before/after —
not a tail-end edit. Note the constraint 125240d8 flagged: do not collapse the ordinary loader's and the
fixed-revision snapshot's history/window semantics while unifying their relation projection.

Metric note: the reuse figure must stay capability-based. A line-level clone detector finds ONE pair in this
repo and an identifier-normalised structural detector at an 8-line window finds two, both import headers —
neither would have found any of the duplication M1 and M2 removed, because it was the same responsibility in
different shapes. Percentages from text similarity are not evidence here.

Spec: source-of-truth, eval-core
