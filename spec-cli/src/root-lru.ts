// @@@ root-lru - ONE bounded root→key cache policy, for every layer that keeps immutable per-HEAD work warm.
// A leaf module on purpose: it imports nothing from the spec graph, the eval sidecar, or git, so both layers
// can depend on it without either owning the other ([[source-of-truth]]).
//
// The policy is reference-counted, not plain LRU, and the distinction is the whole point. Entries are keyed by
// something IMMUTABLE (a HEAD, or a ledger path + HEAD), so two checkouts sitting on the same commit must share
// one entry rather than build it twice. A root moving A→B therefore drops A only when NO other root still
// points at it; otherwise a sequence of successful rebuilds retains one whole index per commit until the slot
// bound finally evicts them. Bumping an unchanged root is a pure recency touch (delete + reinsert), which is
// what makes `roots` insertion-ordered enough for the eviction loop to mean "oldest root".
//
// This existed twice, verbatim in logic and even in name — `touchRoot` in git.ts (index/drift) and again in
// spec-eval's scenariofresh.ts (scenario chains), whose comment said it was "mirroring historyIndex/driftIndex
// in git.ts". Both authors knew; neither had anywhere to put it. Now they do.

// slot bound for one cache family. Every caller names its own env knob and default so operators can tune the
// families independently, but nobody gets to invent a different FLOOR or a bare literal — a cache whose bound
// is a magic number cannot be tuned in the field at all (scenariofresh's was a hardcoded 16).
// @@@ unparseable is not zero - the shape both copies used, `Math.max(4, Number(env || fallback))`, returns
// NaN for a mistyped value, and `size > NaN` is always false: one typo in an env var silently turned the
// bound OFF and let the cache grow without limit. A bound that fails open is worse than no bound, because
// nothing reports it. Anything that does not parse to a positive number falls back to the caller's default.
export const rootSlots = (env: string | undefined, fallback: number): number => {
  const asked = Number(env)
  return Math.max(4, Number.isFinite(asked) && asked > 0 ? asked : fallback)
}

// Record that `root` now wants `key`, evicting what no root wants any more and keeping `roots` within `slots`.
// `cache` is the caller's own keyed store; this owns only the ROOT→key bookkeeping and the eviction decision.
export function touchRoot(
  roots: Map<string, string>,
  cache: Map<string, unknown> & { delete(key: string): boolean },
  root: string,
  key: string,
  slots: number,
): void {
  const previous = roots.get(root)
  if (previous !== key) {
    roots.set(root, key)
    // the old key survives only while some OTHER root still names it — immutable entries are shared, so
    // dropping one root's view must not throw away a sibling checkout's warm work.
    if (previous && ![...roots.values()].includes(previous)) cache.delete(previous)
  } else {
    roots.delete(root)
    roots.set(root, key)   // recency bump: reinsertion is what makes the eviction loop below pick the oldest
  }
  while (roots.size > slots) {
    const oldest = roots.keys().next().value as string | undefined
    if (oldest === undefined) break
    const oldKey = roots.get(oldest)
    roots.delete(oldest)
    if (oldKey && ![...roots.values()].includes(oldKey)) cache.delete(oldKey)
  }
}
