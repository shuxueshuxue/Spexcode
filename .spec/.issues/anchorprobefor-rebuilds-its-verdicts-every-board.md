---
concern: anchorProbeFor rebuilds its verdicts every board build — the one layer that never joined root-lru's per-HEAD policy, and the counter built to catch it is blind to it
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
nodes: eval-tab, root-lru, taste
created: 2026-08-05T16:35:11.280Z
---

Spec: root-lru, eval-tab, off-history-content-probe

## The mechanism indicts itself — no intent change needed

`spec-eval/src/freshness.ts` maintains `rootScopes`: a bounded, HEAD-keyed root→scope map, swapped
atomically on a head move. Its own comment above `freshnessCacheSize()` states the invariant:

> "It must track the corpus's anchors, never how many times the board has been rebuilt — **one
> retained generation, not one per rebuild**."

[[root-lru]] states the same thing at the policy level: one reference-counted bounded root→key cache
policy, **shared by every layer that keeps immutable per-HEAD work warm** — so the same eviction rule
is never written twice.

`anchorProbeFor(root, idx)` (`freshness.ts:564-566`) is such a layer and did not join the policy:

    const verdicts = new Map<string, boolean>()

is a closure local, born and dying with the call. Its sibling `contentProbeFor(root)`
(`freshness.ts:362`) goes through `scopeFor()` and stays warm across calls. Both cache
per-HEAD-immutable facts; only one of them is warm.

**The invariant is declared, it is measurable, and the measurement cannot see the case that breaks
it.** `freshnessCacheSize()` counts `scope.anchors` — the content probe's entries — so the
anchor-selector verdicts sit outside the only counter built to catch exactly this, and get
recomputed once per rebuild in silence. That blindness is the more serious half of this defect; the
milliseconds are its symptom.

## Measured cost (476-node zcode mirror, no server contacted)

Board full build **1710 / 1825 / 1870 ms** (mean 1802) against the product's own **1500ms** budget.
`evalTimelines` is 778–876ms of that; the shared `loadSpecs` baseline lint also pays is 394–524ms.
Same 476 ids with `{ order: true }` (parses and orders rows, deliberately skips freshness probes):
**229.8ms**. Full freshness: **911.7ms** — a **~682ms freshness premium**.

Board population: 476 nodes / 429 with `eval.md` / 2,521 scenarios / 3,023 readings / 3,426 code-axis
entries / 1,072 distinct `codeSha` / **86 selector-bearing entries = 73 distinct anchor queries**.
Those 73 are re-verified on every full rebuild even when HEAD has not moved.

The dimension is **readings and code-axis entries, not node count**: 119 ids → 882 readings →
621.0ms; 476 ids → 3023 readings → 911.7ms (sort-only 40.8 → 229.8ms). Per [[taste]] 18, that is the
lever — memoisation applies, because the work is repeated rather than merely large.

## The fix shape, and the trap in it

The verdicts belong on `RootScope` as a sibling of `anchors`/`behind`, keyed by the existing
`anchorKey(sinceSha, path, selectors)`, reached through `scopeFor()`.

**Do not make it permanent.** A verdict looks content-addressed but is not history-free: it is
computed from `eventsSince(idx, sinceSha, e.path)`, whose window grows as HEAD advances, so a
`false` verdict at one HEAD can legitimately become `true` at the next. It is per-HEAD immutable,
never forever-immutable — which is precisely why the existing HEAD-keyed scope (that a head move
swaps atomically) is the right home and a naive permanent memo is a correctness bug. Per [[taste]] 19
this is the tip-relative half, not the permanent half.

Extend `freshnessCacheSize()` (or add a sibling counter) to count them, so the invariant becomes
observable where it is currently blind. Leaving it uncounted would re-create this defect's real
cause.

## Acceptance

1. **The invariant, not the clock:** a second full board rebuild at unchanged HEAD issues **zero**
   anchor queries. This is the criterion; wall-clock is the symptom.
2. **Byte-equality** against the current per-call recompute across the whole 476-node corpus, per
   [[taste]] 19 — keep the slow, obviously-correct full recompute in the repo as the specification
   and hold the faster path to byte-equality against it. Field-by-field, not spot-checked: narrowing
   a cache scope by inspection is a correctness change wearing a performance change's clothes.
3. **A head move invalidates**, proven by a reading, not by argument: verdicts computed at HEAD are
   not readable back after a commit lands.
4. Fail→pass pair exists cleanly: A = full build 1710–1870ms against the declared 1500ms budget;
   B = under budget with (1) holding.

## Explicitly not in scope

- Switching the board to `{ order: true }`: it deliberately emits `freshnessDeferred`, so that
  removes the signal rather than the cost.
- Splitting the eval domain: a wider correctness change.

The earlier **3755ms** sample is the same path, not a 476-node lower bound: it coincided with the
backend emitting `session summary build failed` and resource-monitor logs, and the synchronous
`sessionEvalProjections()` board call measures 0.4ms in an isolated fresh process. Those are async
projection work interleaving, not the board's synchronous summary.
