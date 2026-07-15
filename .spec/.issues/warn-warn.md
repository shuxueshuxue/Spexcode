---
concern: 低精度 warn 通道会被整体无视：warn 疲劳的量化与治理
by: 28dc443a-d846-4abd-8ead-9422f0ead3f9
status: open
nodes: code-anchor, drift-replay-bench
created: 2026-07-15T08:09:59.184Z
---

## 命题

一个 **precision 低于某阈值的 warn 通道，会被参与者整体无视**——于是它不再是"软提示"，而是把真信号一起藏进一条没人看的通道。这是 drift 门"block vs warn"之争的真实标价，值得作为独立命题去探索。

## 已有证据（本仓，非假想）

- **回放实测**（见 [[drift-replay-bench]] / `docs/drift-anchor-benchmark.md` warn 通道节）：现行 drift 的 warn 通道 **precision 仅 54.7%**，却承载了 **59.6% 的真契约变更**（warn-capture）。掷硬币精度的通道扛着六成真信号——"整体无视"最危险的形态。
- **活样本**：一条 `eval-drift` advisory 在一次 Bm 落地会话里**连响 6 次**，判过一次后被持续 dismiss（那些 stale 是既存、非本次改动所致）。warn 疲劳当场发生、可复现。

## 设计张力（探索时别踩的坑）

1. **"把 warn 全升成 block"不是解，是把 warn 疲劳换成 ack 疲劳。** 逼 agent 对低精度信号逐个 ack → **橡皮图章 ack**（报告已列为效度威胁）。ack 是 load-bearing 的强声明（会 quiet 未来 drift），污染它比忽略一条 warn 更毒。
2. **all-block 就是 B′。** 回放已定价：无锚恒阻断把 precision 75.5%→64.9%、误伤 66→245（约 4×），且打得最重的恰是拆不出 symbol 的高流量 monolith——疲劳最大化的分布。
3. **真正的杠杆是精度，不是 tier 的存废。** Bm（多锚）把引用挤进高精度 block tier、缩小噪声 warn tier，才是降疲劳的正路。

## 可探索方向

- **按精度分 tier，而非按列表分**：symbol 锚 drift = block（Bm 已证 ~77%）；整文件 drift = warn（诚实的低精度=advisory）。合并 `code:`/`related:` 二分、其余引用强制 symbol 精确定位（非可提取文件 json/md/sh 留整文件例外），把 warn tier 越挤越小。
- **eval 版"锚点"**：一条 reading 只在它**真正跑过的那段代码**动了时才 stale，而非任何受治文件一 commit 就 stale。eval 只能 warn（机器证不了行为真坏没坏），故更要靠精度而非强制降噪。
- **量化 warn 疲劳本身**：它是**行为效应**，回放测不了（回放只给决策质量、不主张因果）。需前瞻实验：precision 低于多少后被整体无视？临界阈值是绝对精度、还是相对 block 通道的落差？

## 开放问题

- "整体无视"的临界 precision 阈值是多少？是否随通道音量（每天响几次）变化？
- 该阈值是否就是"block vs warn"的正确切分点：precision ≥ 阈值 → 配 block，< 阈值 → 提精度或干脆不报？
- 是否需要"第三态"（比 warn 更软、只在 dashboard 聚合、从不进 agent 的 stop-gate）来安放证不了又不想丢的低精度信号（如父摘要 pressure）？

Spec: code-anchor, drift-replay-bench
