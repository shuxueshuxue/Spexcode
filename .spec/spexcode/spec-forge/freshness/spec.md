---
title: freshness
status: active
hue: 280
desc: The deterministic incremental-view-maintenance core — a delta-fed cache that keeps node → { issues, prs } fresh without a cold full pull, with reconcile as the source of truth. Sources (poll, webhook) are interchangeable and deferred.
code:
  - spec-forge/src/cache.ts
---
# freshness

Keeping the [[links]] view fresh — incrementally, or live for a dashboard — is **not a product choice**.
`resolveLinks(issues, prs, nodeIds)` is already a **pure function**, so the problem is the classic one of
**incremental view maintenance**: keep `output = f(state)` current as `state` changes, instead of paying
for a cold full pull on every look. This node owns that deterministic core; it sits beside [[links]] and,
like it, is host-agnostic.

**What is incremental is the *fetch*, never the *resolution*.** `resolveLinks` is microsecond-cheap and
pure, so the cache recomputes the whole view on every read rather than maintain a second, incremental
resolution path that could disagree with the full one. The cache adds freshness; it never adds a rival
answer.

**State, delta, view.**

- **State** = the cached open-issue set + open-PR set (node ids stay git-local, from `loadSpecs`).
- **Delta** = one observed change, the single currency every source emits: an *upsert* (the new object,
  still open) or a *remove* (it left the open set — closed, merged, deleted, or its `Spec:` marker
  dropped). `apply` folds one delta in, keyed by number, so it is **idempotent and order-tolerant** — a
  duplicated or out-of-order delta re-sets the same key; a remove of an absent key is a no-op.
- **View** = `resolveLinks` over the cached set.

**Reconcile is the source of truth; sources are only hints.** A live source (an ETag-conditional poll, or
a forge webhook) may drop, duplicate, or re-order deltas, so it is never trusted as a clean stream.
Correctness is restored by **reconcile** — a full read through the [[port]] that overwrites the cached set
wholesale. The invariant the whole design rests on, and the one this node proves:

> after `reconcile()`, `view()` equals a cold full pull **by construction**; and a delta stream that
> represents a set of changes leaves the cache **identical** to a reconcile of that final state.

So any number of live sources can only ever leave the cache *temporarily ahead* of the last reconcile,
never durably wrong. The proof is network-free (`src/proof.ts`): it drives a cache through a delta stream
(new issue, marker edit, close→remove, PR branch change, plus a duplicate and a stale remove) and asserts
the view equals `resolveLinks` of the final state exactly.

The read-only contract holds unchanged: the cache caches a *read* of the forge; it never writes a node's
version or status (that stays git-derived — see [[spec-forge]]).

Out of scope (each a future sibling node, by node granularity): the **delta sources** themselves — an
ETag/`If-None-Match`-conditional poller (free 304s; reads move from `gh issue/pr list` to `gh api` to
carry the ETag) and a **webhook** receiver (`gh webhook forward` for a local dashboard) pushing the same
delta shape over SSE. Both plug into this core's `apply`; neither changes it. Wiring the cache into
`spex forge links` / the dashboard is likewise a separate surface.
