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
