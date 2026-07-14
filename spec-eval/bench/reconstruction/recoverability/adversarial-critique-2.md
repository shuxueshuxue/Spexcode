# Adversarial critique round 2 — content-recoverability protocol asset (frozen)

Provenance: two manager-relayed directives from session "接手 Evo bench"
(`17557c6a-4535-4291-8f73-61df0572ad77`), delivered 2026-07-14 mid-turn to worker
`content-recoverability-c12d` while this node's pre-registration was being authored. Recovered read-only
from that exhausted worker's uncommitted worktree and otherwise copied verbatim. This document is a
**frozen input to the protocol**: `docs/content-recoverability.md` absorbs every condition below. Do not
edit; supersede only with a separately recorded review round.

---

## Round 1 — scale as a first-class dimension（原文）

人类补充：复原对象从纯叶子转为小模块；请把 scale 作为预注册的一等维度。主样本必须是 (a) 带有限子树的父节点，或 (b) 一个小 package 的 size-matched 节点群；leaf 仅可作 calibration/control，不能与 module pooled 或画单一 scale curve。外生定义 module eligibility/size（node count/depth/LOC/files/inbound edges/cross-module coupling）并在看 R0 前冻结；O0 atomic units 仍逐条分类评分，但抽样、macro-average、bootstrap/uncertainty 以 module cluster 为单位。R0 输出/盲包须恢复模块级 responsibility/non-responsibility、节点拓扑/ownership 与跨叶 contract，不只拼叶子正文。主报告按 category × scale（module primary，leaf calibration）分别给 recoverability/unsupported precision；whole 不在本 pilot。同步更新 sampler/schema/rubric/controls/dry checks。

## Round 2 — fresh critique, six hard corrections（原文）

Fresh critique 已完成，请全部吸收到预注册并把原文/摘要作为冻结 protocol asset。六个硬修正：
1. O0 单元在看任何 R0 前按 C0 snapshot 双标 supported(A)/latent(B)/contradicted(S)；主恢复率只在 A 内按类别；B 恢复>20% 触发污染审计 NO-GO，S 被恢复是坏信号；类别×层交叉，类别边际仅描述。
2. 模块内 O0 units 做 census 不抽单元；deterministic segmentation；每 unit 恰一 primary taxonomy（反方建议行为契约/责任非责任边界/ownership拓扑/设计理由/约束不变量/操作机制/历史事故，须在非样本节点开发后冻结）；样本100%双标，category kappa<0.6 修订一次仍不过则 NO-GO；稀疏类 min-cell。
3. module breadcrumb 泄漏：保留树的 inbound mentions/id 会抬 topology。加 tree-only ablation（只见保留树不见 code）；若 tree-only 达 R0 topology/ownership ≥80%，先 scrub/stub inbound 或降 secondary。每模块记录 breadcrumb density。
4. blind controls：O0-self positive、distractor module、shuffled original、10–15% fabricated plausible units；full/partial/absent/contradicted，primary只计full。O0-self recall<95% 或 fabricated false recovery>10% = NO-GO。行为化改写去旧 yatsu 词并保存 raw→rewrite mapping/唯一性 spot-check。judge 排除 constructor gpt-5.5，逐 judge+AC2/alpha+leave-one-judge-out；style identity probe 猜臂>70% 先归一化。
5. 当前 C0 外生 module 规则可能仅≈6 eligible，按 census；n<=6 不做虚假 bootstrap/显著性。category×scale cell <3 modules或<15 units 报 insufficient；eligible modules<4 则 module-primary NO-GO，回退 leaf calibration。pilot定位 descriptive/protocol，不动 future-utility primary。
6. 所有 eligibility/segmentation/A-B-S/taxonomy/rubric/controls 必须在任何 module recon 前 --write freeze、--check byte verify；leaf calibration 可复用已归档 R0但标注者不得先看它。
最小 pilot建议5–6 module recon + 2 leaf复用；module 60–120 units/leaf20–30；1 human+2异族judge；每模块 R0/O0-self/distractor/shuffled 四 bundle + tree-only ablation。whole不进、无 pooled/scale curve。请在 sampler/schema/dry oracle/eval门中机械化这些条件，本轮仍零模型。
