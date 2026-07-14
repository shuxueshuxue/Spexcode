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
  - spec-eval/bench/reconstruction/usage.mjs
  - spec-eval/bench/reconstruction/scorer.mjs
  - spec-eval/bench/reconstruction/browser-scorer.mjs
  - spec-eval/bench/reconstruction/browser-incontainer.mjs
  - spec-eval/bench/reconstruction/codex-adapter.mjs
  - spec-eval/bench/reconstruction/usage.selftest.mjs
  - spec-eval/bench/reconstruction/scorer.selftest.mjs
  - spec-eval/bench/reconstruction/scan.selftest.mjs
  - spec-eval/bench/reconstruction/codex.selftest.mjs
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
CLAUDE_CONFIG_DIR、无网络、只读挂载。隔离靠 docker `--network none`（真 netns；本机 unprivileged
userns 被 apparmor 限死，bwrap 不可用）+ `--add-host` 把 endpoint 钉到 loopback + 容器内→unix
socket→host bridge→endpoint:443 的唯一审计出口；凭证只经 0600 env-file 注入，不进 argv/prompt/
trace/仓库；归档前对 workspace + 全部拟归档 bytes 做 exact/prefix/base64 secret scan，命中即
quarantine 整份工件并停批。stream-json 逐 message-id 按字段单调聚合 usage（cumulative snapshot 不
双计，出现更小值即 accounting-invalid 停批），逐事件核验真实 endpoint model，观测集合必须 =={glm-5.2}
（`<synthetic>` 是本地 error 伪 model，单列不计入），provenance（docker image id、claude 版本+包
digest、runner commit）钉进 trace；mount 集合诚实命名 mount audit，不冒充 open-path log。

## 冻结资产与阶段门

选题、任务框都是确定性冻结、可复验（`select --check` / `episodes --check` / `tasks --check` 字节级
重现）：`targets.json`（C_eval→日历日规则导出 C0=038dce1f；2 leaf + 2 size-matched module + 1 whole）、
`episodes.json`（798 first-parent semantic episodes，482 eligible，**primary horizon = 430 pre-migration**）、
`tasks.json`（每 leaf 取 first-parent 序**最早可回放且作用域自洽** eligible episode——两道机械、
结果无关的排除：依赖同 episode 新建兄弟模块（replay），或改动任何非治理 SOURCE 文件（scope-self-
containment，含增删改，防治理外真实改动被算 scope violation），reason 冻结在 `excluded[]`，绝不按 arm
结果挑；另冻结每 target 的 **counterbalanced arm 顺序**与 `cardsSha256`）+ `task-cards.json`（读任何 O0
前、只据 episode 代码 diff 冻结的 sanitized 行为化 request + hidden acceptance + A/B/C identifiability
stratum）。

`run.ts dry` 仍是无 agent/无网络的快照+门禁+twin 面；`pilot check` 是**付费前必过 rc0** 的无模型回归+
正负对照套件（usage 聚合回归、scorer 正负 control 判别、frames、dry、cards-hash、provenance）。付费
pilot 是 **phase-aware runner**（`run.ts pilot preflight | verify-model | phase --scale leaf`）：**阶段只
改调度，不改冻结的 O0/R0/N0、知识预算、泄漏门、future task、评分口径**。leaf 阶段每 arm 入表前硬门
r.ok+exit0+realCompletion+accounting-valid+model=={glm-5.2}+secret-clean+R0 required-file&schema（空/
失败 R0 绝不静默变 N0）；**两个 leaf 都须有真实行为 scorer 才跑**（单 leaf 固定序不可比）。主 outcome 由
**工作区外真实行为测试**产出，且**产出代码永不在 host 直跑**：spec-lint 在 `docker --network none` 内跑
产出的 lint（合成 git fixture，produced source 只读、fixture 唯一可写），mobile-ui 用无头 chromium 跑产出
App.jsx（CDP `Network offline` 断网沙盒；浏览器 JS 无宿主 fs）驱动 board-poll 竞态；两者正负 control 证明
能拒未改 pre-state（付费前 `pilot check` rc0）。归档全部 raw+二进制 bytes 做 exact/prefix/base64 全零 secret
scan（prefixHits 也计）；首个 hard failure 经共享 abort 停发新 arm、只让在途收尾归档，不补跑。phase 前置
绑定同一 runnerCommit/imageID/claudeDigest/endpoint/model：读 preflight.json/check.json/verify-model
trace，verify 须 ok+exit0+realCompletion+accounting-valid+model{glm-5.2}+secret-clean 才放行（429 verify
不 admit）。逐 run 归档 prompt/config/manifest/trace/workspace/scorer raw/scope（pre/post diff 含删除）/
上游 commit/token/session set。C0=038dce1f 只支撑 protocol pilot；confirmatory 结论至少需第二个外生 C0
复跑。module/whole 阶段的调度是下一步（不改选题）。executor 是**适配器 registry**（不写 if(codex)）：
GLM 行 429 挂起期间，Codex 行为已批准替代——每 attempt mode0700 HOME/CODEX_HOME/CODEX_SQLITE_HOME、
env -i allowlist、结构化 argv、外层 no-network 容器、临时 config.toml provider row、auth 仅 per-run
env/helper（不碰 ~/.codex）；parser 严格（唯一 thread.started+turn.started+turn.completed，usage 取
唯一 terminal 不求和，CLI 无 model id → modelVerified 需 provider response trace）。一个 batch 只用一
provider，绝不混跑；真实 model gate 未启用，等已批准 endpoint/credential/slug。

## 规矩

- 改任何预注册规则（RULES、allowlist/forbidden 面、选题/episode 判据）= 重新预注册：同一提交里
  重新 `--write` 冻结文件并在提交理由里声明；`--check` 不过即门破。
- 未经泄漏门与 twin 检测力验证的快照，产出的任何 R0 无效；分数解读以 protocol 文档为准。
