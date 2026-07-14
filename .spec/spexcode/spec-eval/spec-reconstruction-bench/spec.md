---
title: spec-reconstruction-bench
status: active
hue: 170
desc: 自然演化 spec vs 代码重建 spec 的信息价值 benchmark —— historical time-split（C0 快照三匿名臂 O0/R0/N0），三尺度三 estimand 分开预注册，主指标是前向真实任务效用；dry-oracle（快照/泄漏/canary/选题/episode/task frame 全冻结与门禁）+ phase-aware 付费 pilot runner（隔离 Claude Code/GLM-5.2 executor，阶段只改调度不改冻结选题），leaf 阶段已实现。
code:
  - spec-eval/bench/reconstruction/run.ts
related:
  - spec-eval/bench/reconstruction/pilot.mjs
  - spec-eval/bench/reconstruction/sandbox.mjs
  - spec-eval/bench/reconstruction/bridge.mjs
  - spec-eval/bench/reconstruction/targets.json
  - spec-eval/bench/reconstruction/episodes.json
  - spec-eval/bench/reconstruction/tasks.json
  - spec-eval/bench/reconstruction/task-cards.json
  - spec-eval/bench/reconstruction/adversarial-critique.md
  - docs/spec-reconstruction-bench.md
---
# spec-reconstruction-bench

[[extractor-bench]] 度量锚点切分，[[drift-replay-bench]] 度量 block 判据；本节点度量更根本的问题：
**仓库里自然演化的 .spec，相对于从剥离 spec 的代码快照重建出的 spec，信息价值差多少**。方法是
historical time-split：选定过去提交 C0，导出无 git、无 .spec 的 allowlist 快照；三个匿名臂——
O0（C0 当时的自然 spec）、R0（隔离 agent 只看快照重建）、N0（无 spec 对照）——一律用 C0 之后
**真实发生**的 future episodes 评前向效用。original 不是 oracle，只是一个臂。

## 三尺度 = 三个分开的 estimand（禁止总分、禁止 scale curve）

- **leaf = body completion**：遮一个叶子，父兄弟与 id 保留——诚实命名，不声称 discovery。
- **module = ontology completion**：遮一个模块子树，树其余保留；子树拓扑与 ownership 由重建者定。
- **whole = coarse discovery**：遮全部 .spec，只评 root/package/module 层；单仓 N=1 只作 case study。

## 主指标与评分

主指标是**前向决策/实现效用**：future episodes 按 A（artifact-identifiable）/ B（O0-only latent）/
C（新需求）分层，A 层才检验 reconstruction，A+B+C 只检验 practical utility。文本事实恢复只作
机制指标，且只评 C0 快照可独立支持的 atomic facts；BLEU/嵌入相似度只作污染诊断。臂标签随机匿名，
human + 两个异族模型 judge 盲评，逐 judge 报告 agreement 与 leave-one-judge-out；near-miss 与
shuffled-original 两种负对照跨三尺度验证 rubric 非审美。细则全部预注册在 `docs/
spec-reconstruction-bench.md`；反方 critique 原文是冻结的协议资产（`adversarial-critique.md`），
其 §8 列出推翻反方结论的预注册门。

## 泄漏纪律（generation 阶段）

快照按 **allowlist 默认拒绝**组成，显式 forbidden 面带理由剥除（harness 物化、README/报告镜像、
bench 冻结数据、插件种子模板、spec 种子脚本——后两项正是本门在 whole 干跑里抓到的）；masked spec
正文抽 shingle 全量扫描（非代码文件命中=违规，代码内回声只记录）；future-leak canary 用窗口
added-lines 扫快照与 prompt（只门禁 generation，不管评测期任务 prompt）；污染 canary 成对——
clean 快照零 plant，leak-positive twin 故意开放禁面并植入唯一错误需求，门必须报警才算有检测力。
重建 agent 用隔离的 Claude Code + GLM-5.2（已批准 BigModel Anthropic endpoint）、fresh HOME/独立
CLAUDE_CONFIG_DIR、无网络、只读挂载，open-path manifest 归档。隔离靠 docker `--network none`（真
netns；本机 unprivileged userns 被 apparmor 限死，bwrap 不可用）+ `--add-host` 把 endpoint 钉到
loopback + 容器内→unix socket→host bridge→endpoint:443 的唯一审计出口；凭证只经 0600 env-file 注入，
不进 argv/prompt/trace/仓库；每个 stream-json 事件的 model 逐条核验，观测 model 集合必须 =={glm-5.2}，
否则整批作废。

## 冻结资产与阶段门

选题、任务框都是确定性冻结、可复验（`select --check` / `episodes --check` / `tasks --check` 字节级
重现）：`targets.json`（C_eval→日历日规则导出 C0=038dce1f；2 leaf + 2 size-matched module + 1 whole）、
`episodes.json`（798 first-parent semantic episodes，482 eligible，**primary horizon = 430 pre-migration**）、
`tasks.json`（每 leaf 取 first-parent 序**最早可回放** eligible episode——机械 replay 检查排除依赖同
episode 新建兄弟模块的候选，reason 冻结在 `excluded[]`，绝不按 arm 结果挑）+ `task-cards.json`（读任何
O0 前、只据 episode 代码 diff 冻结的 sanitized 行为化 request + hidden acceptance）。

`run.ts dry` 仍是无 agent/无网络的快照+门禁+twin 面。付费 pilot 是 **phase-aware runner**（`run.ts pilot
preflight | verify-model | phase --scale leaf`）：**阶段只改调度，不改冻结的 O0/R0/N0、知识预算、泄漏门、
future task、评分口径**。preflight 无模型调用即落 gate 摘要（frames/dry/凭证 mode/endpoint 可达/沙盒三阴
性+贯通/零残留/secret-scan 检测力），全绿方可自动继续；leaf 阶段并行重建两 leaf 的 R0，再对每 leaf 跑
同一冻结 future task 的 O0/R0/N0 executor（臂只差中性投影 bundle，N0 空），逐 run 归档 prompt/config/
manifest/trace/workspace/scorer raw/上游 commit/token/duration 并 secret scan。任何泄漏、model 非
glm-5.2、secret 命中、归档失败即停整批，失败行如实归档不补跑。C0=038dce1f 只支撑 protocol pilot；
confirmatory 结论至少需第二个外生 C0 复跑。module/whole 阶段的调度是下一步（不改选题）。

## 规矩

- 改任何预注册规则（RULES、allowlist/forbidden 面、选题/episode 判据）= 重新预注册：同一提交里
  重新 `--write` 冻结文件并在提交理由里声明；`--check` 不过即门破。
- 未经泄漏门与 twin 检测力验证的快照，产出的任何 R0 无效；分数解读以 protocol 文档为准。
