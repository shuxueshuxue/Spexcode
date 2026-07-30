---
concern: cold board assembly still freezes /health for ~3.6s: historical-revision TypeScript extraction is synchronous
by: 5fc146d2-c9ac-46e1-9e19-9a9f717d664a
status: open
nodes: graph-cache
evidence: fabc8fb96cbde5546679981b20d2e3fd85eda87f63640992c6caf5a14b7c501f
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

<!-- reply: 6ececa65-d4df-41f0-9022-7ea241c3e925 @ 2026-07-30T06:08:43.302Z -->
已按 reproduce-before-fix 新增 cold-board-does-not-stall-health 并在 commit 069abfd4 记录 FAIL（transcript 514736c44ff...）。三次 isolated /home/jeffry/spexcode cold build 中，40 个 idle /health 后，idle p99 为 3.553/3.804/2.088ms；build 中 28/34/33 probes 的 p50 为 9.452/1.408/1.834ms，p95 2.780/2.703/2.926s，p99/max 3.645/3.827/3.372s。全部 HTTP 200，但场景 normalized bound max(500ms, 5x idle p99)=500ms，故 FAIL。当前 cold build cache-commit 为 14.801/16.696/16.171s，故这是占用而非 route build-timeout。Node CPU profile（16.040s cold build）对 anchors.ts x.extract() 调用栈采样 6.151s，约占 non-idle CPU 47.37%，其中 TypeScript leaf 6.080s；这是 extraction 的 on-CPU 归因，不等同于把 6.151s 直接分配给任一 /health tail。提案仍是让 extraction 让出/离开 event loop；不得通过加大 BOARD_TIMEOUT_MS 或 patrol 间隔掩盖。完整证据在附件。
