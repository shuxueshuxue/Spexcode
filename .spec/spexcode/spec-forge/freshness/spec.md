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
- **View** = `resolveLinks` over the cached set. The cache also exposes the raw set itself (`state()`),
  because one consumer — the unified Issue port (spec-cli's [[issues]]) — needs *every* cached issue,
  linked or not, to map onto the one Issue type; resolution stays the only *derived* view, so there is
  still no second answer to disagree with the full one.

**Reconcile is the source of truth; sources are only hints.** A live source (an ETag-conditional poll, or
a forge webhook) may drop, duplicate, or re-order deltas, so it is never trusted as a clean stream.
Correctness is restored by **reconcile** — a full read through the [[port]] that overwrites the cached set
wholesale. The invariant the whole design rests on, and the one this node proves:

> after `reconcile()`, `view()` equals a cold full pull **by construction**; and a delta stream that
> represents a set of changes leaves the cache **identical** to a reconcile of that final state.

So any number of live sources can only ever leave the cache *temporarily ahead* of the last reconcile,
never durably wrong — the invariant holds **by construction**: a delta stream representing a set of changes
leaves the cache identical to a reconcile of that final state, and `reconcile()` makes `view()` equal a cold
full pull. (Verifying this is the job of the test framework — see [[spec-yatsu]] — not an ad-hoc script.)

The read-only contract holds unchanged: the cache caches a *read* of the forge; it never writes a node's
version or status (that stays git-derived — see [[spec-forge]]).

The **first delta source is live**: the *updated-since window* — the [[port]]'s optional incremental read
(`listIssuesSince`) feeds `applyIssues` (an upsert merge: an issue never leaves the set, a closed one
updates in place) while the small open-PR list is simply re-set whole. The resident cycle is
incremental-first: after the seeding reconcile, each TTL tick fetches only that window (normally one page)
instead of re-listing the world, and a **periodic full reconcile stays the backstop** for what an update
window cannot see (deleted/transferred issues) — exactly the "sources are hints, reconcile is truth"
contract above. Still future siblings: an ETag/`If-None-Match` poller (free 304s) and a **webhook**
receiver pushing the same delta shape; both plug into `apply`, neither changes it.
