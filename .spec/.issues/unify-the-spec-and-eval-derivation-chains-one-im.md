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

<!-- reply: c89038e2-6b56-4b4c-8b4a-4ff4ec2c886e @ 2026-07-30T02:39:01.922Z -->
M4 measured. **The package cycle is not a tangle and does not need a new package.** Recording this before
cutting, because it overturns the premise the milestone was authorized on.

## Counting convention (state it or "how much did it drop" is unfalsifiable)

Count **import statements**, non-test `.ts` only, and separate **static** from **dynamic** — static edges bind
the module graph, dynamic edges exist to defer binding:

    spec-cli -> spec-eval   static 12 / 5 files   index 5 · graph 3 · reviews 2 · graphStream 1 · graphCache 1
                            dynamic  7            cli 3 · sessions 1 · localIssues 1 · …

An earlier figure of 36/12 counted imported SYMBOLS; a coordinator's 17/8 counted statements without the
static/dynamic split. Same tree, three numbers.

## The static module graph is already acyclic

Every spec-cli module that spec-eval imports has **zero** static imports of spec-eval:
`git specs layout anchors issues source-files mentions` → 0; `sessions localIssues lint harness` → 0 static
(sessions and localIssues carry 1 dynamic each).

And the five spec-cli files that DO import spec-eval are exactly the delivery layer — `index`, `graph`,
`graphStream`, `graphCache`, `reviews` — and all 12 symbols they take are eval PRODUCT (export rendering,
timelines, projections, filing, human-ok, the evidence blob cache). Not one is a derivation.

So the real structure is already a clean three-layer DAG:

    substrate (git · anchors · layout · specs · source-files · mentions — 0 eval deps)
        ↑
    spec-eval (eval features)
        ↑
    delivery (index · graph · graphStream · graphCache · reviews)

The package-level "cycle" is an artifact of **packaging granularity**: substrate and delivery share one
package, so the package graph shows a cycle the module graph does not have.

## The true cycle is two symbols

    spec-cli/sessions.ts    --dynamic--> sessioneval    because spec-eval/sessioneval --static--> sessions.reviewPayload
    spec-cli/localIssues.ts --dynamic--> filing         because spec-eval/humanok     --static--> localIssues.commitTrunkData

`cli.ts -> spec-eval/cli -> lint.loadConfig` is NOT a cycle: lint.ts never points back.

`sessions.ts`'s own comment admits the workaround: *"The import is dynamic for the same reason the lint
gate's is — the eval package imports this module."* Third instance of this pattern in this refactor — an
author documenting a structural problem in the act of working around it, because the structure offered
nowhere else to go.

## Consequence: the cut is a relocation, not a repackaging

The cycle exists because two eval-CONSUMING functions live in lower modules: `sessions.ts`'s `evalGate()` and
`localIssues.ts`'s filer-chain resolution. Move them UP into the delivery layer — `reviews.ts` already imports
spec-eval statically — and the dynamic edges become ordinary static ones. No new package, no boundary
redraw, and the counter goes to zero as a CONSEQUENCE rather than as the goal.

## The one contract decision, and the default taken

The knot: spec-eval needs `reviewPayload`, and `reviewPayload` internally wants the eval gate — mutual need at
the FEATURE level, which is what no amount of repackaging fixes. Two answers: (a) `reviewPayload` keeps
carrying the gate, and the cycle stays, deferred by a dynamic import forever; (b) the delivery layer COMPOSES
payload + gate, and `reviewPayload` returns only session-side data.

Taking (b): it is the layering-correct answer and it returns `reviewPayload` to knowing only its own layer.
Flagged for [[manager-cockpit]] in case composing at the caller changes an outward contract someone depends
on — say so before the next milestone lands if it does.

Spec: sessions-core, manager-cockpit, source-of-truth

<!-- reply: c89038e2-6b56-4b4c-8b4a-4ff4ec2c886e @ 2026-07-30T03:00:10.661Z -->
Cycle 2 measured before cutting, and it is **three nodes, not two** — which changes the fix and rules out the
obvious cut.

## The actual ring

    spec-eval/{sessioneval,scenarios,…}  --static (3)-->  spec-cli/issues.ts
    spec-cli/issues.ts                   --static (1)-->  spec-cli/localIssues.ts
    spec-cli/localIssues.ts              --dynamic(1)-->  spec-eval/filing.ts   ← the deferral point

## Two candidate cuts, and why the obvious one fails

**Move `commitTrunkData` down.** It looks right: the function is a pure store primitive (override/primary
guards, store lock, `git add` + one-path commit) with no issue logic, sitting in `localIssues.ts` only because
that is who first needed it, and spec-eval's `humanok` imports nothing else from that module. But it does NOT
break the ring: spec-eval also imports `issues.ts` statically in three places, and `issues.ts` imports
`localIssues.ts`, so the ring survives with one edge fewer. (Worth noting for its own sake:
`withStoreLock`'s lock is named for the FORUM (`spexcode-forum.lock`), so extracting these as a "generic store
module" would be wrong — eval's human-ok commit deliberately serialises against forum writes. That is a real
shared-lock decision, not an accident, and it should not be renamed into something that hides it.)

**Move the eval-aware originator resolution up.** This is the necessary cut, and it is the same shape as the
cockpit fix. `localIssues.ts` carries `EVAL_CONCERN_RE = /^eval: (.+?) · (.+)$/` and resolves an eval reading's
FILER — eval's concern format and eval's filer lookup, living inside the issues module. That is the dependency
that need not exist, exactly as `gates.evals` was a field its eval caller never read.

Its consumer chain forces where "up" has to be: `threadOriginators` is called only by `replyLocalIssue`, whose
only caller is `issues.ts:218` — and spec-eval imports `issues.ts`. So the composition cannot land in
`issues.ts` either; it has to sit ABOVE spec-eval, in the delivery layer, the same altitude `cockpit.ts` found.
Shape: `replyLocalIssue` returns thread + dispatch outcomes and stops resolving originators; a composer above
eval performs the loop-in. Constraint to respect while doing it: the loop-in is contracted by [[mentions]] and
[[remark-substrate]] R3 (fallback chain — reading filer first, then the node's governing session, delivered to
the first online link, notification only, resolving nothing), so the behaviour must survive the move intact,
and the eval-comment thread's chain must still reach a filer resolved from BOTH the trunk sidecar and each live
session's worktree sidecar.

## Not started

This touches the remark/notification path under two contracts, and the analysis above is what the cut needs to
rest on rather than a guess about where the code should go. Recorded here so the next step begins from the ring
shape rather than re-deriving it — the obvious cut being wrong is precisely the thing worth not rediscovering.

The pattern count is now four, and a coordinator named its third variant well: repetition documented but
retyped; a cycle documented but deferred; a redundant carry documented but guarded by a comment. Underneath:
the structure offered the author nowhere correct to put the thing, so the cost went into a comment and was
paid anyway. These are not "someone wrote this wrong" — they are "there was no right place to write it".

Spec: mentions, remark-substrate, source-of-truth
