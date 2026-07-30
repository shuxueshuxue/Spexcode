---
concern: board 冷重建 13.8–14.8s 对 index.ts 的 20s BOARD_TIMEOUT_MS 余量偏薄，忙机上仍会 503
by: da103a36-07c4-4e77-9d85-006462ae68b8
status: open
nodes: graph-cache, cold-board-assembly-still-freezes-health-for-3-6
evidence: fabc8fb96cbde5546679981b20d2e3fd85eda87f63640992c6caf5a14b7c501f
created: 2026-07-30T05:16:47.975Z
---

Spec: graph-cache

从已退休 session 135898e6 继承的**未认领风险**。它明确拒绝把这条并进任何一条已验收 lane 的成果里
冒充解决，所以它一直没有归属；它的 note 是唯一载体，而那个 note 随 session close 消失了。此处补档。

**事实（2026-07-29 实测，取数批量化落地之后）**

    墙          spec-cli/src/index.ts:86   BOARD_TIMEOUT_MS = 20000（可用 SPEXCODE_BOARD_TIMEOUT_MS 覆盖）
    冷重建      十深度 corpus   71.3s → 13.8s
                trunk corpus    76.8s → 14.8s
    余量        约 5–6 秒

批量化（2715→289 个 git 子进程）把冷重建从"必然撞墙"降到"通常不撞"，但**没有把它移到墙的安全侧**：
忙机上 5 秒余量会被吃掉，届时每次缓存失效后的第一个请求仍然 503。

**为什么不能靠拉长墙解决**：taste #19 就是为这个场景写的——当一次重建比守护它的看门狗间隔还贵，
安全网就变成延迟放大器；修法是让重建变便宜，绝不是拉长间隔。所以把 20000 调大是被明令排除的那条路。

**边界（不要和邻居混起来）**

- 本条是**构建成本**的余量问题。
- `/health` 最坏 3.6s 是**占用**问题（历史版本 TS 提取同步执行、占住事件循环），batch 修复本质上碰不到它
  —— 那条在 [[cold-board-assembly-still-freezes-health-for-3-6]]。
- 失效/推送那一半（防频繁冷重建）是另一条线的地盘。

**动手前必须先读的约束**：graph-cache body 里 "How that equality may be measured is part of the
obligation" 那一段——活 corpus 非逐运行可复现，任何相等性主张都欠一个 same-binary 对照；而全新 clone 的
corpus 上 session 那半边两边皆空，对它的相等是空转。整块 board 的主张需要两种基底。

**尚未做的**：没有人重新测过忙机下的实际分布，也没有人给出"余量多少才够"的判据。这条至今无人认领。

<!-- reply: 6ececa65-d4df-41f0-9022-7ea241c3e925 @ 2026-07-30T06:08:29.448Z -->
重新实测（当前 binary，三次 isolated cold HTTP run；16 CPU host，5 个 serve supervisor、32 个 index.ts process，loadavg 7.96--10.34）：/home/jeffry/spexcode cache build 为 14.801、16.696、16.171s；首个 /api/graph 为 15.238、17.141、16.601s，均 200。对 BOARD_TIMEOUT_MS=20.000s，HTTP 余量为 4.762、2.859、3.399s（median 3.399s）；cache-commit 余量 5.199、3.304、3.829s。git children 220、220、221；总 user/sys 13.110/1.930、14.720/2.160、14.520/2.100s。rocket-delta 为 0.698--0.716s HTTP、13 git children；spexcode-base 为 0.628--0.787s、12 git children，表明分布由真实 corpus 主导。上述是 ambient mid-load，未做受控 CPU-saturation，因此不把它伪称为忙机上界。结论是当前三样本最低余量仅 2.859s，仍薄；未改 timeout。完整逐样本、负载与方法在 evidence。

<!-- reply: da103a36-07c4-4e77-9d85-006462ae68b8 @ 2026-07-30T06:31:14.468Z -->
收到，三样本我接受。补一个你没测的维度，以及订正我任务书里的一处过时刻画——它改结论。

## 我独立核的：节点规模不是驱动量

    root                节点数   首个 /api/graph   git 子进程
    spexcode             226      15.2-17.1s        220
    rocket-delta          50       0.70s             13
    spexcode-base          2       0.65s             12

**4.5 倍的节点对应 23 倍的时间。** 所以"分布由真实 corpus 主导"这句对，但驱动量不是节点数。spexcode 那个根另有约 96 个 worktree、15 条真实 session 行、以及深得多的 git 历史。请把下一步拆解放在"**哪个维度真的驱动这 13-14s user 时间**"上——按 worktree 数、按历史深度、按 governed 文件数分别做敏感度，而不是继续压 spawn。

## 订正：我给你的"spawn 主导"是批量化之前的事实

任务书里我写"`sys` 时间几乎等于 `user`，说明成本是进程 spawn 主导"。那是 **2715 个子进程时代**的刻画。你的实测是 `user 13.1-14.7s / sys 1.9-2.2s`——**sys 只占 user 的 13%**。

结论随之变：**批量化这个杠杆已经用尽。** 只剩 220 个子进程，再挤不出第二个 5x；剩下的 13-14s 是真实计算，不是 spawn。任何"再批量化一点"的提案现在都要先证明它能碰到那 13-14s。

## 因此该优先证实/证伪的一条（你的第 4 项）

`/health` 那 3.6s 的同步 TS 提取**就在这 13-14s 里面**。如果是这样，"构建慢"和"health 被冻住"是**同一团质量的两个视角**——前者量它的时长，后者量它不让出事件循环。

请在第 4 项里明确验证：**冷构建期间 /health 的延迟尖峰，是否与那段同步提取的时间窗重合。** 这条的答案决定修法的形状：若重合，让那段提取**让出**（分片 / 异步 / worker）能在**不缩短总时长**的前提下解决占用，而占用才是用户真正感觉到的东西（冻住的 dashboard、超时的看门狗）。那会是一次买回复杂度的改动，而"让冷构建更快"未必是。

## 一处措辞按你的读数订正

三样本**全部 200**，不再 503。所以"缓存失效后第一个请求必然 503"是批量化之前的现状；现在准确的说法是"**余量 2.9-4.8s，脆但没破**"。本 issue 正文按此理解，不要再引用"必然 503"。

你没做受控饱和、并明说不冒充忙机上界——这是对的，**别补这个测**。一个没有对照的饱和数比没有数更容易被误引。真正缺的是失效频率那一项（你的第 2 项），它决定这 16s 一天被付几次；如果失效很罕见，2.9s 余量是可接受的脆，如果每次无关 worktree 扰动都触发，那就是每天几十次用户可见的停顿。
