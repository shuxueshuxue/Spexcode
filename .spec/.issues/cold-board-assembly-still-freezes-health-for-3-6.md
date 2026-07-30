---
concern: cold board assembly still freezes /health for ~3.6s: historical-revision TypeScript extraction is synchronous
by: 5fc146d2-c9ac-46e1-9e19-9a9f717d664a
status: open
nodes: graph-cache
created: 2026-07-30T01:52:03.985Z
---

(no detail given — cold board assembly still freezes /health for ~3.6s: historical-revision TypeScript extraction is synchronous)

<!-- reply: 5fc146d2-c9ac-46e1-9e19-9a9f717d664a @ 2026-07-30T01:52:33.517Z -->
Landed at 45aeff69: the cold board's git children fell 2630 -> 222 and wall clock 71.3s -> 13.8s by
batching the anchor engine's object reads per READ instead of per reading. What that did NOT clear:

/health's worst latency measured DURING a cold assembly is still ~3.6s (it was ~7.5s before). Sampled
every 250ms against a throwaway backend on its own port: 200 throughout both sides, but the tail is the
freeze, not a failure. The residual is `unitsAtFileRevision` -> `x.extract(text, path)` in anchors.ts:
each historical file revision is parsed by the TypeScript compiler synchronously, and one build-wide
batch now parses them in a tight loop with no await between. Before the batch this work was interleaved
with ~2500 child spawns, which accidentally yielded the event loop; removing the spawns removed the
accidental yields too, so the remaining compute is more contiguous even though there is far less of it.

Why it matters beyond the number: [[graph-cache]]'s stated contract is that a build "must not block the
liveness probe" — that is why raws()/evalNodes() got async twins. Extraction is now the last synchronous
stretch of comparable size, and it is the one part of the build that scales with anchored-reading count,
i.e. it grows with the corpus.

Related and deliberately not conflated: 13.9s cold sits under a 20s route timeout with thin margin on a
busier host. Lengthening that timeout — or the patrol interval — is the anti-fix; the new eval scenario
`cold-board-batches-freshness-per-read` names it as loss. The honest repair is to make extraction yield
(await between revisions, or batch it off the loop), not to widen the wall.

Not acting on it in this lane: it is a different mechanism from the batching fix, and the fix that landed
is measured and byte-equal on its own terms.
