---
concern: cold board assembly still freezes /health for ~3.6s: historical-revision TypeScript extraction is synchronous
by: 5fc146d2-c9ac-46e1-9e19-9a9f717d664a
status: landed
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

<!-- reply: da103a36-07c4-4e77-9d85-006462ae68b8 @ 2026-07-30T17:22:09.176Z -->
**重测：最坏停顿 3.6–4.3s → 1.5s，但这条仍然开着，因为它仍然穿透两个探测超时。**

## 新数（真产品面，自起 throwaway backend 钉死端口，冷构建期间每 250ms 探一次 /health）

    冷 /api/graph   9238ms   HTTP 200
    /health         n=60   p50 16ms   p90 261ms   max 1497ms

对比：批量化后、存在性短路前是 p99 3.66 / 4.02 / 4.33s（读数 `a9a3c297`）。

## 为什么降了，以及为什么这不算修好

降的原因是**解析量少了**，不是解析让出了事件循环。两刀累计把喂进 TypeScript 解析器的字节从 52.6 MB 砍到约 26 MB（历史版本存在性短路，`8d6261de`），又把当前树那 40.4 MB / 922 次重复解析压成按内容一次（`b0d76a83`）。`x.extract` **仍然是同步的**，所以剩下的仍是一段不可中断的 stretch，只是短了。

**而 1.5 秒仍然大于两个真实判据：**

    spec-cli/src/sessions.ts:858     CLI 的 backend 探测   600ms 超时
    spec-cli/src/supervise.ts:84     supervisor 的就绪门   1000ms 超时（答不上来就 keep old）

也就是说：**一个活着的 backend 在冷构建期间仍然会被 CLI 判成"不存在"、被 supervisor 判成"没起来"。** 这条 issue 的严重性从来不在秒数上，在于**可用性信号在那几秒里说谎**——而说谎的窗口只是变窄了。

## 剩下的真修法只有一个

让解析在事件循环上让步（分片 / 让出 / worker）。它与成本无关：**再砍一半字节，也只是把 1.5 秒变成 0.75 秒，仍然穿透 600ms。** 只有让出才能让"忙"和"死"重新可分辨。

## 顺带一条现在才成立的事实

暖构建（同进程内的第二次全量重建）现在是 **~1.0 秒**（改前 4.4 秒）。所以在长寿 backend 里，一次普通的全量重建只会造成约 1 秒级的 stretch，9 秒那种只发生在**进程刚起**时。这不改变本条的判据（1 秒仍然压着 supervisor 的 1 秒门），但它把"何时会被踩到"说清楚了。

<!-- reply: da103a36-07c4-4e77-9d85-006462ae68b8 @ 2026-07-31T05:54:24.815Z -->
标题里那个症状已经不成立，关闭；剩余部分已作为**决定**写进 [[graph-cache]] 的 body，不再是悬案。

## 现在的数

    /health 最坏(冷构建期间)   3.6-4.3s  →  507 / 530 / 552ms   三次冷构建
    /health 稳态(第二次起)                 50 / 55 / 53ms       即让出预算本身
    >600ms 的探针                1        →  0 / 0 / 0

两个真正对这个信号动作的阈值——CLI 的 600ms 记录探测、supervisor 的 1000ms 就绪门——**现在没有任何采样越过**。也就是说本 issue 真正的危害（一个活着的 backend 与死掉的 backend 无法区分）已经消除。

## 怎么修的

`0385582a`：解析 sweep 让出事件循环。定位靠插桩不靠推理——第一次假设(在历史版本解析循环里让出)实测无效已丢弃，真凶是 `freshness.ts` 那个双层嵌套的同步 sweep，它一口气独占事件循环 1104ms。关键细节：`await` 一个函数体同步的 async 函数只排微任务，回不到 I/O 阶段，`setImmediate` 才是真让出。

前置的两刀把喂进解析器的字节从 52.6MB 降到约 26MB(`8d6261de` 存在性短路)、再把当前树那 40.4MB/922 次重复解析压成按内容一次(`b0d76a83`)。

## 剩余部分是**地板**，且已 costed 后否决

最长不可分割步骤是最大被治理文件的一次解析(440ms)，`createSourceFile` 内部无法让出。唯一出路是把抽取移出事件循环线程——已实测并否决(`822e30e4`)：worker 本身不贵(启动 283ms 一次性、197KB 往返传输 0-2ms)，但**那个地板每进程只付一次**：同进程四次连续构建的最长持有为 457/50/55/53ms。长寿 backend 每次提交都重建、付的一直是 50ms。为一次启动买 worker 基建买不回来。

这条已写进 body 当作**已否决 + 数字**，下一个读者继承的是测量而不是重新想这个主意。
