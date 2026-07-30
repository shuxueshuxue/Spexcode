---
concern: freshness 的 content-batch loud-failure 测试在 main 上长期红，且已 bisect 到批量化之前——无人认领
by: da103a36-07c4-4e77-9d85-006462ae68b8
status: open
nodes: graph-cache
created: 2026-07-30T06:55:29.440Z
---

Spec: graph-cache

## 事实

    spec-eval/src/freshness.test.ts
    not ok - content batch: spawn failure is loud, not memoized, and a repaired child path retries
        operator: 'rejects'
        expected: /git content diff failed \(spawn\)/
        actual:   undefined          ← 本该 reject 的调用没有 reject

在**钉住的 Node 22** 上复现（所以它不是 `agent-node-24-nvmrc-22-lane` 那条幻影失败；Node 22 下 spec-eval 是 155 tests / 154 pass / **1 fail**，就是这一条）。

## 我 bisect 过，结论和我的假设相反

我原本的假设是：批量化那一刀（`95d296cb` graph-cache — the board's freshness reads are ONE batch per build）破了 loud-failure 契约，而它的逐字节相等证明只覆盖 happy path、看不见错误路径。

**实测推翻了这个假设：**

    95d296cb（批量化本身）        → 41 tests / 40 pass / 1 fail   红
    95d296cb^ = 49fe9cc5（之前）  → 41 tests / 40 pass / 1 fail   同样红

所以它在批量化**之前就已经红了**，不是那一刀引入的。（`49fe9cc5` 恰好就是批量化 lane 自己 sweep 里用的 OLD 基线。）报告"这是既有失败、不是我引入的"的那几条 lane，在这一条上是对的。

## 为什么仍然要认领

测试名本身说的是这个项目的硬规矩：**spawn 失败必须响亮、不许被 memo 掉。** 一条断言"失败要响亮"的测试正在失败，字面含义就是：**在某条路径上，一次 spawn 失败没有变成响亮的 reject，而是变成了 undefined。** 按项目原则（fail loudly，不要静默回落），这类红比一条普通功能红更值得优先——它守的正是"错误不被吞掉"这件事。

而且它藏在"既有失败"这个筐里已经很久：没有人 bisect 过它、没有人判断过那个 undefined 是**测试的布置过时**还是**产品真的吞了错误**。这两者的区别决定它是十分钟的活还是一个真 bug：

- 若是测试过时（批量化重排了错误的抛出点/包装文案），修断言，并把新文案写进 body。
- 若是产品真吞了，那是一条静默失败，必须按 reproduce-before-fix 走 A/B。

**先分辨，再修。** 不要为了让它变绿而放宽正则——那会把"响亮"这条契约本身改软。

## 已排除

不是 Node 版本导致（Node 22 下同样红），不是批量化引入（父提交同样红）。
