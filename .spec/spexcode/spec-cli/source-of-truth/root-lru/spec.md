---
title: root-lru
status: active
hue: 200
desc: One reference-counted bounded root→key cache policy, shared by every layer that keeps immutable per-HEAD work warm — so the same eviction rule is never written twice.
code:
  - spec-cli/src/root-lru.ts
related:
  - spec-cli/src/root-lru.test.ts
  - spec-cli/src/git.ts
  - spec-eval/src/scenariofresh.ts
  - spec-eval/src/freshness.ts
---

# root-lru

## raw source

The same bounded-slot cache guard was written three times: `touchRoot` in `git.ts` for the index/drift
caches, `touchRoot` again in spec-eval's `scenariofresh.ts` for scenario chains — same name, same
reference-counted eviction, same recency bump — and a third, simpler per-root scope in `freshness.ts`.
Both duplicate authors documented it as they wrote it (`freshness.ts`: "the same bounded-slot guard the
index caches use"; `scenariofresh.ts`: "mirroring historyIndex/driftIndex in git.ts"). Nobody was careless.
There was nowhere to put a policy that belongs to neither the spec layer nor the eval layer, so each grew
its own copy — and the copies drifted where nobody could diff them: three bounds (32 / 64 / 16), two env
knobs, and one bare literal that no operator could tune at all.

## expanded spec

root-lru owns ONE question: given a root that now wants `key`, what stays warm and what is evicted. It is a
leaf module by construction — it imports nothing from the spec graph, the eval sidecar, or git — so both
layers depend on it without either depending on the other. That is the shape the whole spec/eval
unification is aiming at: shared derivations live somewhere neither consumer owns.

The policy is **reference-counted, not plain LRU**, and that distinction is its reason to exist. Entries are
keyed by something IMMUTABLE — a HEAD, or a ledger path plus HEAD — so two checkouts on the same commit
share one entry instead of building it twice. A root moving A→B therefore drops A only when no other root
still names it; evicting eagerly would throw away a sibling worktree's warm work, and never evicting would
retain one whole history-shaped index per commit until the bound finally bit. Re-touching an unchanged root
is a pure recency move (delete then reinsert), which is what leaves `roots` insertion-ordered enough for the
eviction loop to mean "the oldest root".

Each caller names its own env knob and default, because the families are tuned independently — index/drift
work is not scenario-chain work. What no caller may do is invent a different floor or, worse, a bare
literal: a cache bound that is a magic number cannot be tuned in the field, which is exactly what
`scenariofresh.ts`'s hardcoded 16 was. The floor lives here, once.

Consolidation also has to fix what both copies shared. The bound was read as
`Math.max(4, Number(env || fallback))`, which yields **NaN** for a mistyped env value — and `size > NaN` is
always false, so a single typo silently turned the bound off and let the cache grow without limit. A bound
that fails OPEN is worse than no bound, because nothing reports it. Anything that does not parse to a
positive number now falls back to the caller's default. Neither copy was ever going to surface that on its
own; it took putting them side by side.

`freshness.ts` keeps a genuinely different structure — one scope per root, replaced when that root's head
moves, with no sharing between roots — and is deliberately NOT forced onto this policy. Unifying unlike
things is how a shared layer becomes a second special-case pile; the test for belonging here is that the
caller wants the reference-counted immutable-key rule, not merely that it wants a bound.
