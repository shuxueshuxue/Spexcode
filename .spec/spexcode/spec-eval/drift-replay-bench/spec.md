---
title: drift-replay-bench
status: active
hue: 200
desc: drift block 判据的策略级 benchmark —— 回放本仓真实历史 drift 事件，冻结 LLM 盲评真值上给五策略（A1/A3/单锚命中/多锚花名册/无锚恒阻断）出 Y1 定位器 P/R + block/warn 动作通道对照；铺 Y2 地基（staleness episodes + R1 曝露下界）；并带父摘要 pressure 描述轨（子 spec 版本压父 body，祖先序回放 + π_p 人工盲审队列）。回放只给决策质量，不主张因果。
code:
  - spec-eval/bench/drift-replay.ts
related:
  - spec-eval/bench/pressure-track.ts
  - spec-eval/bench/drift-anchors.json
  - spec-eval/bench/drift-multi-anchors.json
  - spec-eval/bench/multi-anchors-check.ts
  - spec-eval/bench/drift-truth.json
  - spec-eval/bench/human-audit-queue.json
  - spec-eval/bench/pressure-audit-queue.json
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
五个策略：A1 一次 drift 即 block；A3 累计 3 次才 block（退役的 driftErrorThreshold）；B 锚点命中才
block（现行，判交直接调用产品引擎 `anchorHitCommits`，单元按该 commit 当时的文件内容提取，无锚节点
永不 block）；Bm 多锚花名册任一 selector 命中即 block（逐 selector 走同一引擎后取并集，0 号即种子锚
故 Bm 阻断集 ⊇ B，无锚节点同 B 永不 block——bench 策略，非产品行为，分数是产品要不要跟进的证据）；
B′ 同 B 但无锚节点恒 block（量化"无锚=advisory"这个产品选择的代价）。

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

## 父摘要 pressure 轨（描述轨，不定级）

代码 drift 之外的第二种失效面：**直接子节点的 spec 内容版本可能把摘要型父 body 压成过期**。本轨
只做确定性回放枚举，**不实现任何运行时 lint/gate 行为，不选 block vs warn**——定级要等 π_p 与
前瞻实验（规矩末条）。语义规定死：

- 事件 = 直接子 spec.md 的内容版本且未在同一 commit 融合更新父（融合计 co-versioned，无失效间隙）；
  父 spec 在该 commit 祖先里尚不存在的计 parent-not-yet-born 边界，如实报、不猜。**全部次序只用
  git 祖先关系，永不看时间戳**（平行 tip 的钟序无意义）。
- 归结四通道：父内容更新 / 命名该父的 `Spec-OK` ack / parallel（平行 tip 上不可比的双归结，如实报
  不仲裁）/ open。**ack 只覆盖被点名的父与 ack 祖先可见的子版本**；trailer 可观察，ack 是否真经
  重读不可观察，按边界上报。**pressure 是谓词不是计数**——open 事件数是下次改写的批量待办，不是
  严重度倍数；一次父改写/ack 成批覆盖全部祖先可见待办（batching）。父更新可向上再压它自己的父
  （深度严格递减，有限收敛），永不向下。
- 每个归结性父更新同时上报**是否会掩掉父自身 `code:` 文件的待处理 code drift**（版本重置副作用）——
  只上报，不裁决意图。曝露 = 未归结 span 内兄弟子版本上的外来 `Session:` trailer 去重数，git-only
  **下界**（无 trailer 记 unattributed，阅读不可见）。
- **π_p（pressure 命中里父 body 真需重写的比例）不可由 git 得出、本轨不估**：
  `pressure-audit-queue.json` 按父深度分层（每非空层保底 3 行）确定性抽 40 行盲审队列等人填，
  机器不许碰；填满前一切 pressure 数字只是事件计数，不得称人工验证。抽样框冻结在生成时 HEAD
  （文件内 `frozenAt`）——后续 spec 提交不重排样本，确定性门跨 HEAD 稳定。
- 七条可执行断言进验收门：仅向上传播、深度递减有限收敛、反环、batching 恰分割、无向下振荡、
  分类完备（含边界如实报）、队列确定性+盲。

## 多锚点标注轨（盲注，已计分为 Bm）

单锚花名册每节点只许钉一个单元；多锚标注回答"这份契约由几个命名单元承载"。`drift-multi-anchors.json`
对每个已锚定节点给出同一 base 文件里的 1–3 个命名单元：0 号永远是种子锚，追加锚**只在 spec body 的某条
独立承重承诺一对一落在该命名单元上时才加，绝不为提召回而加**。标注是盲注：只准看节点当前 spec body、
code 路径、产品提取器的 AST 单元清单、单锚种子花名册——truth、盲审队列、评审票、漏报/策略分析一律不看，
且花名册**先提交、后看真值**。每条 selector 带简明理由与来源哈希（file/spec 的 blob oid），按节点名确定性
排序。`multi-anchors-check.ts` 是它的复现门：一条命令过结构（单 base 路径、唯一性、禁 bare/scoped 混用、
0 号=种子）、经产品提取器在钉住的 sourceOid 上解析（dead/ambiguous/typeOnly 即非零退出）、盲性字段扫描、
字节级确定性重序列化；HEAD 漂移只如实上报不判死。

计分即 Bm 策略（见"方法"），且盲性升格为回放里的机器门：花名册工作树字节 = HEAD、历史上恰一个内容
提交（再标注必须动这个门并在提交理由里说明）、注释提交不携带任何冻结标签工件（truth/基线/双队列）、
frozenAt ⊑ 注释提交 ⊏ 打分 HEAD、外加 Bm⊇B 超集断言（0 号=种子 ⇒ 结构上不可能新增 FN）。每个 B→Bm
翻转按节点+selector 逐条归因（新 TP / 新 FP），剩余 FN 按节点点名。Bm 分数入冻结基线；**它只是 Y1
定位器证据，产品是否让 `code:` 携带多 `#symbol` 是 [[code-anchor]] 自己的改动，不由本表单独裁决**。

## 九件套

- `drift-replay.ts` — 一条命令：`npx tsx spec-eval/bench/drift-replay.ts`。回放全量历史出行为轨，
  对冻结真值出主表 + 动作通道 + episode 段 + pressure 轨 + 双队列校验 + 验收门（judged 全匹配、
  通道互斥完备、队列确定性/无泄漏、窗口分类完备、pressure 七断言、基线一致），任一门破即非零退出。
- `pressure-track.ts` — 父摘要 pressure 轨本体（上节语义的实现），由 drift-replay.ts 调起；
  `--emit-audit-queue` 同时再生两份盲审队列。
- `drift-anchors.json` — 锚点花名册（96 个 JS 受治节点：64 有锚、32 判定整文件治理即无锚）。花名册
  是 benchmark 的输入，独立于 .spec 里实际落地的锚。
- `drift-multi-anchors.json` — 多锚点盲注花名册（64 个已锚节点、119 个 selector，39 个多单元；上节
  协议）。Bm 策略的输入；不可变/盲源由回放验收门机器检查，分数入基线。
- `multi-anchors-check.ts` — 多锚花名册的复现/校验门：`npx tsx spec-eval/bench/multi-anchors-check.ts`。
- `drift-truth.json` — 冻结的 227 条盲评真值（两轮分层 + 权重）。**不许手改**；扩充真值 = 新增盲评
  轮次并在提交理由里说明抽样与评审设置。
- `human-audit-queue.json` — 40 行盲审队列（生成：`--emit-audit-queue`）。等人填；机器不许碰。
- `pressure-audit-queue.json` — π_p 的 40 行按深度分层盲审队列。同规矩：等人填；机器不许碰。
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
