---
title: content-recoverability
status: active
hue: 185
desc: C0-supported O0 intent 的 category-by-category O0->R0 recoverability 预注册；module primary、leaf calibration，先冻结 census/labels/controls，再允许任何 reconstruction。
code:
  - spec-eval/bench/reconstruction/recoverability/run.mjs
related:
  - docs/content-recoverability.md
  - spec-eval/bench/reconstruction/recoverability/schema.json
  - spec-eval/bench/reconstruction/recoverability/taxonomy.json
  - spec-eval/bench/reconstruction/recoverability/rubric.md
  - spec-eval/bench/reconstruction/recoverability/unit-card.template.md
  - spec-eval/bench/reconstruction/recoverability/adversarial-critique-2.md
  - spec-eval/bench/reconstruction/recoverability/frame.json
  - spec-eval/bench/reconstruction/recoverability/units-skeleton.json
  - spec-eval/bench/reconstruction/recoverability/tree-only-ablation.json
  - spec-eval/bench/reconstruction/recoverability/segmentation-audit.md
  - spec-eval/bench/reconstruction/recoverability/segmentation-audit.json
  - spec-eval/bench/reconstruction/recoverability/rewrite-map.json
  - spec-eval/bench/reconstruction/recoverability/control-plan.json
  - spec-eval/bench/reconstruction/recoverability/run-state.json
  - spec-eval/bench/reconstruction/recoverability/freeze-manifest.json
  - spec-eval/bench/reconstruction/recoverability/runs/dry-report.json
  - spec-eval/bench/reconstruction/recoverability/runs/verification-transcript.txt
---
# content-recoverability

[[spec-reconstruction-bench]] 的 primary 仍是 historical time-split 上的 future decision/implementation
utility；本节点只预注册一个不替代 primary 的机制问题：C0 的自然 O0 中，哪些**由 C0 code-only
快照独立支持**的内容类别能在 R0 里完整恢复。whole 排除，module 是 primary analysis unit，两个既有
leaf 只作不 pooled 的 calibration。

## 冻结先于 reconstruction

模块 eligibility 外生取自父 bench 的 C0/package roster：非隐藏 parent subtree 必须有 2--8 个后代、
相对深度不超过 2；同规模 package roots 可组成 size-matched group。实际 eligible modules 全量进入
census，模块内 O0 prose 由确定性 segmenter 全量切 unit，不抽 unit。taxonomy 先在非样本 dev pool
定稿；随后每个样本 unit 在任何 R0 前由两名标注者仅据 C0 快照给 A-supported、B-latent 或
S-stale/contradicted，并给恰一 primary category。所有规则、unit 边界、rewrite、rubric、control plan
和最终 labels 都必须先 `--write` 冻结，再由 `--check` 字节复验；任何门未齐，preflight fail loud。
完整 census 实测为 620 module units、659 real cards、至少 1508 次独立 pre-adjudication 判断，远超反方
的 provisional 60--120 总量估计；任何 R0 前还必须有人类明确批准这份负担，或在零 R0/零结果时以新
外生 module-scope 规则重冻 frame。unit 抽样不是修复路径。

## 结论边界

Primary 只按 A x category 报 full recovery；partial 只作 secondary，S 的任何 full recovery 是坏信号，
B 超过污染阈值先停结论做 audit。小样本只描述：少于 4 个 eligible modules 时 module-primary NO-GO；
category x scale 少于 3 个 modules 或 15 units 时只报 insufficient counts，不报 rate/CI；n<=6 禁
bootstrap、显著性、pooled score 与 scale curve，historical-incident 永远不是 primary conclusion。

Blind controls 包括 O0-self、distractor、shuffled original、10--15% fabricated plausible units、
module tree-only ablation 与 style identity probe。O0-self、fabricated、breadcrumb、judge agreement、
constructor-family exclusion、逐 judge/AC2/alpha/LOO 的完整门写在冻结协议中。tree-only 若达到 R0
topology/ownership 的 80%，该类必须 scrub/stub 后重测或降为 secondary。后续预算面固定为实际六个
module recon 加 2 个 reused leaf；当前有效 module R0 = 0，本节点的 runner 没有模型或网络入口。
