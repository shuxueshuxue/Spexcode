---
title: drift-replay-bench
status: active
hue: 200
desc: drift block 判据的策略级 benchmark —— 回放本仓真实历史 drift 事件，冻结 LLM 盲评真值上给四策略（A1/A3/锚点命中/无锚恒阻断）出 Y1 定位器 P/R + block/warn 动作通道对照；并铺 Y2 地基（staleness episodes + R1 曝露下界）、固化 40 行人工盲审队列与指标基线门。回放只给决策质量，不主张因果。
code:
  - spec-eval/bench/drift-replay.ts
related:
  - spec-eval/bench/drift-anchors.json
  - spec-eval/bench/drift-truth.json
  - spec-eval/bench/human-audit-queue.json
  - spec-eval/bench/drift-baseline.json
  - docs/drift-anchor-benchmark.md
  - spec-cli/src/anchors.ts
---
# drift-replay-bench

[[extractor-bench]] 度量提取器"单元切得准不准"；本节点度量上一层的问题：**drift 什么时候该 block**。
[[code-anchor]] 把 block 判据从计数换成锚点命中，这个换法值多少，要有可复跑的数字，不能停留在叙述。

## 目标变量（两个，不许混）

- **Y1 定位器轨（已计分）**——逐 commit：这个 diff 是否触及 spec 所述契约。全部 P/R 表都是这个口径。
- **Y2 运行时目标（只有地基）**——逐状态：此刻 spec 是否失效、需要人回头看。两者在 spec-先行分提交
  与 ack 后窗口上分叉。episode 轨（见下）是 Y2 的铺垫，成为计分轨前需要按窗口补齐标注。
- **回放不主张因果**：所有数字是对标签的决策质量；门对行为的效应（失效时长、橡皮 ack、warn 疲劳）
  只能由前瞻实验回答，不在本节点射程内。

## 方法

事件 = (节点, spec 版本窗口, 触碰受治文件的非 merge commit)，在该 commit 落地的时刻问该不该 block。
四个策略：A1 一次 drift 即 block；A3 累计 3 次才 block（退役的 driftErrorThreshold）；B 锚点命中才
block（现行，判交直接调用产品引擎 `anchorHitCommits`，单元按该 commit 当时的文件内容提取，无锚节点
永不 block）；B′ 同 B 但无锚节点恒 block（量化"无锚=advisory"这个产品选择的代价）。

真值双轨。行为轨全量自动：commit 同时改了该节点 spec.md（仪式的融合提交）= 作者当时判定动了契约。
语义轨是主轨：分层抽样的事件各由三个互不通气的盲评（严格条文 / 可观察行为 / 维护者审计三种视角）
读"窗口起点版本的 spec body + 该 commit 对受治文件的 diff"判契约相关性，多数票为真值，盲评看不到
行为标签和锚点判定。语义轨冻结在 `drift-truth.json`，打分按判定时的分层规模加权还原总体——真值和
权重都冻结，分数才跨次可比。

在同一份冻结真值上再出三样：

- **动作通道**——每事件按策略归入恰好一个通道（block/warn/silent，无重复计数；非 block 的 drift
  事件带产品 advisory WARN，故四策略下 silent 结构性为空），报 block P、warn P、warn-capture
  （真契约变更被降级到 advisory 的份额）——B 与 B′ 之争的真实标价。
- **staleness episodes（Y2 地基）**——确定性重组：onset = 窗口内第一个已判真非融合事件，仅当其
  前缀全部已判才 sound；resolution = 收尾版本提交或窗口内命名该节点的 Spec-OK ack（按祖先关系）；
  R1 曝露 = onset 后 resolution 前触碰受治文件的外来 `Session:` trailer 去重数（无 trailer 记
  unattributed，不计入——git-only 下界）。撑不住的窗口如实报 unresolvable，不猜。
- **人工盲审队列**——`human-audit-queue.json`：按六格总体占比最大余数法确定性抽 40 行（格内
  sha256(id) 序），只带盲评上下文，不带任何标签字段。人填 `humanVerdict/humanNote` 后按 id 回join
  真值校准 LLM 评审。模型永远不许代填；填满前不得称"经人工验证"。

## 五件套

- `drift-replay.ts` — 一条命令：`npx tsx spec-eval/bench/drift-replay.ts`。回放全量历史出行为轨，
  对冻结真值出主表 + 动作通道 + episode 段 + 队列校验 + 验收门（judged 全匹配、通道互斥完备、
  队列确定性/无泄漏、窗口分类完备、基线一致），任一门破即非零退出。
- `drift-anchors.json` — 锚点花名册（96 个 JS 受治节点：64 有锚、32 判定整文件治理即无锚）。花名册
  是 benchmark 的输入，独立于 .spec 里实际落地的锚。
- `drift-truth.json` — 冻结的 227 条盲评真值（两轮分层 + 权重）。**不许手改**；扩充真值 = 新增盲评
  轮次并在提交理由里说明抽样与评审设置。
- `human-audit-queue.json` — 40 行盲审队列（生成：`--emit-audit-queue`）。等人填；机器不许碰。
- `drift-baseline.json` — 冻结真值轨指标基线（Y1 各策略 P/R + 通道指标）。任何位移非零退出；有意
  改动 `--update-baseline` 并在提交理由里说明。行为轨与 episode 数随 HEAD 自然演化，不入基线。

## 规矩

- **block 判据的改动**（换判交算法、换窗口定义、加新策略）必须复跑本 benchmark 并把新表写进改动
  的提交理由；分数回退即不合，有意换取要更新基线并说明。
- 报告正文在 `docs/drift-anchor-benchmark.md`，含方法细节、格子明细与效度威胁；本节点的分数解读
  以报告为准。
- 由本 benchmark 引申的运行时改动（父节点 pressure 的 block/warn 定级、lint 判据变更）**不由回放
  数字单独裁决**：定级要等 π_p（pressure 命中里父 body 真需重写的比例）与曝露实测，行为效应要等
  前瞻实验。
