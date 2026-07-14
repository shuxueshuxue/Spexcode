# spec-reconstruction-bench — 预注册协议（frozen protocol）

本文档是 [[spec-reconstruction-bench]] 的完整预注册。冻结输入：`spec-eval/bench/reconstruction/`
下的 `targets.json`（选题）、`episodes.json`（future-task 抽样框）、`adversarial-critique.md`
（反方终稿原文，约束集）。任何规则改动 = 重新预注册：同一提交里重新 `--write` 冻结文件并在提交
理由中声明。本文档自身在快照的 forbidden 面里（自泄漏防护）。

## 1. 问题与设计

**问**：自然演化的 .spec（含历史沉淀）相对于从无 spec 代码快照重建的 spec，对未来真实工作的信息
价值差多少？**法**：historical time-split。pin `C_eval`（authoring 时 main 头 5723eaca），按日历日
规则导出 `C0` = C_eval 的 committer UTC 日期减 21 天当日最新 first-parent 祖先 → **038dce1f
(2026-06-23)**。三匿名臂全部锚定 C0：

- **O0** — C0 当时的自然 .spec（yatsu/.config 旧词汇期，as-is）；
- **R0** — 隔离 agent 只看 C0 的无 git、无 .spec allowlist 快照重建的 spec；
- **N0** — 同一快照、不给任何 spec（对照）。

三臂一律评 C0 之后真实发生的 future episodes。**O0 不是 oracle，只是一个匿名臂**——不得用 original
文本、taxonomy 或嵌入相似度当答案键。C0=038dce1f 非外生 cutoff（反方核查在案），只支撑 protocol
pilot；confirmatory 结论至少需第二个外生 C0 复跑。

## 2. 三尺度 = 三个分开的 estimand

| scale | 遮蔽 | 保留 | 诚实命名 | 报告 |
|---|---|---|---|---|
| leaf | 单叶子目录 | 父、兄弟、id、入边 | **body completion**（非 discovery） | 按叶子分开 |
| module | 模块子树 | 树其余（含外部 related/mentions） | **ontology completion** | 按模块 block 宏平均 |
| whole | 全部 .spec | 无 | **coarse discovery**（只评 root/package/module，≤3 层） | N=1 case study，只描述 |

**禁止**：跨尺度合成总分、scale curve、micro-average。冻结选题（`targets.json`，选题器只看 C0 树
结构 + 窗口 git 活动，永不看 O0 内容/后续 spec/臂表现；salt=sha256(c0:cEval:relDir)）：
leaf = `spec-lint`（spec-cli 层）、`mobile-ui`（spec-dashboard 层）；module = size-matched pair
`sessions/comms`(5) + `sessions/lifecycle`(4)，Δ=1；whole ×1。共 **5 次 R0 重建**。

## 3. 知识预算与泄漏纪律（generation 阶段）

**主预算 = tracked-repo-without-spec/history**：快照内 code/tests/docs/configs 全部是合法证据
（预注册在此，事后不得改口称污染）。**负对照预算 = production-code-only**（`--budget code-only`：
另剥 docs/、.spec 外全部 .md、test/spec/e2e 文件），只跑小对照。

快照组成是 **allowlist 默认拒绝**（顶层目录 + 根文件 + 扩展名白名单，落选即剥并记 `default-deny`），
另加显式 forbidden 面（带理由记入 manifest）：harness 物化（CLAUDE.md/AGENTS.md/.claude/.codex）、
根 README* 叙事镜像、docs 报告镜像、`spec-eval/bench/**` 冻结数据、`spec-cli/templates/spec/**`
插件种子模板、`scripts/seed-spec-history.sh` 种子脚本（后两项由 whole 干跑的泄漏扫描实际抓获）。
门（`run.ts dry`，任一破即非零退出）：no-git、no-symlink、allowlist、mask 正确性、forbidden-strip、
**masked-shingle 泄漏扫描**（masked 正文每 .md 抽 ≤12 条最长行 shingle；非代码文件命中=违规，
源码内回声只记录不判死——代码是研究对象本身）、**future-leak canary**（窗口 added-lines 中 C0 不存在
的行，扫快照+PROMPT；只门禁 generation，评测期任务 prompt 合法含新需求，不受此门）、prompt-clean、
双跑 manifest 字节级确定性。**成对污染 canary**：plant（唯一且错误的 plausible requirement，
`SRB-LEAK-CANARY-9c41…`）只存在于 leak-positive twin 故意开放的禁面上；clean 快照零 plant、
R0 输出零复述；twin 的 mask/leakage/plant 三门必须全部报警，否则 canary 无检测力、整个 dry 判破。

**隔离执行（R0 generation）**：Claude Code + GLM-5.2 launcher（`claude-glm` 包装器一族），fresh
HOME + 独立 CLAUDE_CONFIG_DIR（每 run 一次性目录，禁全局记忆/项目 CLAUDE.md），无网络，快照唯一
只读挂载 + 可写 `.spec-recon/`，open-path manifest（strace/沙盒审计）随工件归档。R0 输出对 masked
原文跑同一 shingle 扫描：异常 phrase overlap 触发 leakage audit（模型训练记忆亦在此网内）。

## 4. Future-task 框（episodes.json，已冻结）

窗口 C0..C_eval 的 **798 个 first-parent transitions = semantic episodes**（一个 no-ff 合并 = 一个
episode，分支内 commit 不重复计数；反方核查数字一致）。机器排除（理由全记录）：empty(2)、
measure-only(41)、spec-only(264)、rename-only(0)、dependency-only(8)、revert(1) → **482 eligible**。
epoch 按首次全树词汇迁移（548a0386，其合并 episode 4181bd23）切 pre(699)/migration(1)/post(98)：
**primary horizon = 430 条 pre-migration eligible**；跨 epoch 不 pooled；migration 本身只可作单独
format-adaptation stratum。backport/cherry-pick/vendor 类残余由盲审在 task 候选阶段二次排除
（patch-id/trailer）。

**任务分层**（候选生成前，由不看 O0 的标注者冻结）：**A** artifact-identifiable（C0 允许工件足以
支持）、**B** original-only latent（C0 工件没写但 O0 已写）、**C** 真新需求。**A 层才检验
reconstruction；A+B+C 只检验 practical utility**；O0 在 B 层占优是历史沉淀的真实价值，不并入 R0
的恢复真值。future prompt 用行为语言改写（sanitized issue request），不要求 agent 猜新旧术语。

**下游执行**：fresh agent 只见 (a) 该 episode 精确 pre-state 的无 git 快照、**剥离全部 intervening
spec 更新**，(b) 同一 sanitized request，(c) O0/R0/N0 之一经中性投影注入。目标 diff/commit
message/future tests/docs/reports 一律 withhold；acceptance 在沙盒外回放。whole 尺度只用
module-level future（模块路由/责任边界/跨模块/public interface），不用叶子 bugfix；outcome =
affected-module P/R、scope violations、behavioral acceptance、regression。

## 5. 中性投影面（防格式混杂）

C0 是旧词汇期，禁止一臂 native 旧格式、一臂现行 .spec。三臂在评审与下游注入前统一投影为
**neutral intent bundle**：每节点一条 `{path, title, one-line intent, ownership claims(文件列表),
body prose}` 的纯文本记录，剥掉 frontmatter 语法、状态字段、evals 侧车与一切格式署名；N0 = 空
bundle。judge 与下游 agent 只见 bundle，不见 native 文件。投影器随 pilot harness 落地（本版本
未实现，先冻结格式）。

## 6. 评分（臂标签随机匿名，多方盲审）

候选生成前冻结 **atomic fact cards**（只收 C0 快照可独立支持的事实；original 不参与制 key）与
**future decision cards**（源自 primary-horizon episodes 的真实决策）。每匿名候选按 0–3 评五维：
supported-fact recall、unsupported/contradicted precision、responsibility/non-responsibility 边界、
ownership/graph integrity（可机器辅助：投影后 lint 结构、ownership 对 C0 文件树的可解析性）、
future decision calibration。judge = ≥1 human domain judge + 2 个异族模型；均不知臂、顺序、
original 文本、生成 prompt。逐 judge 报告 + Gwet AC2 或 Krippendorff α + leave-one-judge-out——
去掉任一 judge 排名翻转即不得给单一 consensus。下游 hidden-test pass/regression/scope/tokens
独立报告。BLEU/ROUGE/嵌入只作污染诊断。标签映射 sealed（哈希承诺进 manifest，判分完毕才解封）。

## 7. Pilot 算术（预算获人工批准后才启动）

6 个 future task（leaf×1/leaf、module×1/module、whole×2 module-level）× O0/R0/N0 = **18 主 runs**；
两种负对照（polished near-miss：打乱一条 ownership/责任边界；size-matched shuffled original）
各跨三尺度一次 = 6 → **总 24 runs**（不是 21）。module-size 协变量记录 LOC/文件数/node 数/深度/
original facts/入边/测试文档量/耦合。**pilot 只判协议、泄漏、rubric 灵敏度、可回放性与方差，
不宣称臂胜负。** 所有成功与失败工件（快照 manifest、prompt、transcript、open-path、评分表、
label map）内容寻址归档为本节点 eval 证据。

## 8. 推翻反方结论的预注册门（原文见 adversarial-critique.md）

- clean canary 零命中，leak-positive twin 高命中，open-path 无越界；
- near-miss 与 shuffled 显著低于真实 candidates（rubric 非审美）；
- O0 明显优于 N0（否则任务本身未证明 spec 有用）；
- R0 在 A 类 future 稳定优于 N0，且对 O0 非劣于预注册 margin（task success ≤10pp、
  module-impact F1 ≤0.10）；
- 排名跨 judges、executors、module-size strata、≥2 个 C0 稳定，高分不伴 original phrase overlap；
- whole 优势仅在 module-level future 上成立。

反方维持结论的条件同样冻结在 critique §8 末段。任何一门失败都如实报告——本 benchmark 的产出
允许是"未识别 reconstruction"。
