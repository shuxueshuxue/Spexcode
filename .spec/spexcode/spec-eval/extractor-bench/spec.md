---
title: extractor-bench
status: active
hue: 150
desc: 锚点提取器的仓库内可复跑 benchmark —— 冻结语料 + AST oracle 真值 + 打分器,给每个 Extractor(ts-ast、heuristic 语言行)出 名称P/R + 区间精度 对照表;算法改动与新语言行都以分数说话,回退即不合。
code:
  - spec-eval/bench/run.ts
related:
  - spec-eval/bench/oracle.ts
  - spec-eval/bench/seed-r5b.ts
  - spec-eval/bench/corpus/manifest.json
  - spec-eval/bench/truth.json
  - spec-eval/bench/baseline.json
---
# extractor-bench

code-anchor 的语言接缝(`spec-cli/src/anchors.ts` 的 `Extractor`:ts-ast 与 heuristic(LangSpec) 两种实现)
需要一个**制度化的损失信号**:提取器算法怎么改、语言数据行怎么加,都要有同一张分数表可依。本节点把调研期的
验证材料收进仓库,变成一条命令可复跑的 benchmark。

## 三件套

- **冻结语料** `spec-eval/bench/corpus/` — 代表性文件的**内容快照**(`.snap` 后缀,manifest 记录原路径、
  语言类别、冻结提交)。必须冻结:引用活文件会随代码演化让分数漂移,历史分数就失去可比性。快照取自本仓库
  自身代码,无版权问题;语料只收代表性文件,不塞全库。含四类:backend-ts、jsx、plain-js,以及**阴性对照**
  (shell/html——正确行为是零单元或拒绝解析)。
- **真值** `truth.json` — 由 `oracle.ts`(TypeScript 编译器 AST,JSX-aware)从冻结语料生成并提交。
  语料与真值同源同冻结,一起演化。
- **打分器** `run.ts` — 一条命令:`npx tsx spec-eval/bench/run.ts`。对花名册里每个提取器,在其 claims 的
  语料上打分,输出 提取器 × 语言类别 × 切片(all / value-only,后者剔除 typeOnly) 的**名称查准/查全 +
  区间精度(端点误差 ≤2 行)** 对照表;阴性对照强制喂给每个提取器,返回任何单元都计假阳性(抛错=正确拒绝)。

## 花名册与接线位

打分对象来自 `spec-cli/src/anchors.ts` 的纯函数提取器(动态 import:注册表 `extractors()` 的每一行,加上
参考行 `JS_LANG_R5B` 喂给 `heuristicExtractor`)。该文件尚未合入时,run.ts 退回内置种子 `seed-r5b.ts`
(调研期验证过的 R5b 启发式)先把管道跑通——那个动态 import 就是接线位,anchors.ts 合入后不需要改动
benchmark 一行,重跑即得 ts-ast 与 heuristic:js 的正式对照表,存为本节点 eval 证据。

## 规矩(改提取器的人的义务)

- **新增语言数据行**(LangSpec)必须同一改动内附带该语言的 labeled 语料样本(冻结快照 + truth 标注,
  oracle 生成或手工标注皆可)并跑出分数——没有语料的语言行是无损失信号的盲改,不收。
- **提取器算法改动**必须复跑 benchmark:run.ts 将聚合分与提交在案的 `baseline.json` 对比,任一指标回退
  即非零退出——**分数回退即不合**;有意接受的换取(如查准换查全)要在同一改动里更新 baseline 并在 spec
  提交理由里说明。新行首次出分用 `--update-baseline` 写入基线。
- 语料扩充只收**代表性**文件,并保持既有快照不动(动快照=作废历史分数,需在提交理由里declare)。
