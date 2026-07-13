---
title: drift-replay-bench
status: active
hue: 200
desc: drift block 判据的策略级 benchmark —— 回放本仓库真实历史上的 drift 事件，用冻结的 LLM 盲评真值给三种 block 策略（一次即block / 欠3计数 / 锚点命中）出 precision/recall/误伤数 对照表；判据改动以分数说话。
code:
  - spec-eval/bench/drift-replay.ts
related:
  - spec-eval/bench/drift-anchors.json
  - spec-eval/bench/drift-truth.json
  - docs/drift-anchor-benchmark.md
  - spec-cli/src/anchors.ts
---
# drift-replay-bench

[[extractor-bench]] 度量提取器"单元切得准不准"；本节点度量上一层的问题：**drift 什么时候该 block**。
[[code-anchor]] 把 block 判据从计数换成锚点命中，这个换法值多少，要有可复跑的数字，不能停留在叙述。

## 方法

事件 = (节点, spec 版本窗口, 触碰受治文件的非 merge commit)，在该 commit 落地的时刻问该不该 block。
三个策略：A1 一次 drift 即 block；A3 累计 3 次才 block（退役的 driftErrorThreshold）；B 锚点命中才
block（现行，判交直接调用产品引擎 `anchorHitCommits`，单元按该 commit 当时的文件内容提取）。

真值双轨。行为轨全量自动：commit 同时改了该节点 spec.md（仪式的融合提交）= 作者当时判定动了契约。
语义轨是主轨：分层抽样的事件各由三个互不通气的盲评（严格条文 / 可观察行为 / 维护者审计三种视角）
读"窗口起点版本的 spec body + 该 commit 对受治文件的 diff"判契约相关性，多数票为真值，盲评看不到
行为标签和锚点判定。语义轨冻结在 `drift-truth.json`，打分按判定时的分层规模加权还原总体——真值和
权重都冻结，分数才跨次可比。

## 三件套

- `drift-replay.ts` — 一条命令：`npx tsx spec-eval/bench/drift-replay.ts`。回放全量历史出行为轨，
  再对冻结真值出主表。judged 事件若因历史改写而对不上，非零退出而不是默默少算。
- `drift-anchors.json` — 锚点花名册（96 个 JS 受治节点：64 有锚、32 判定整文件治理即无锚）。花名册
  是 benchmark 的输入，独立于 .spec 里实际落地的锚（`pending: true` 的行是选了锚但因命中未处置的
  活 drift 暂未写进 .spec 的节点，照常回放）。
- `drift-truth.json` — 冻结的 148 条盲评真值（票型、格子、行为标签、锚点判定）。**不许手改**；扩充
  真值 = 新增盲评轮次并在提交理由里说明抽样与评审设置。

## 规矩

- **block 判据的改动**（换判交算法、换窗口定义、加新策略）必须复跑本 benchmark 并把新表写进改动
  的提交理由；分数回退即不合，有意换取要说明。
- 报告正文在 `docs/drift-anchor-benchmark.md`，含方法细节、格子明细与效度威胁；本节点的分数解读
  以报告为准。
