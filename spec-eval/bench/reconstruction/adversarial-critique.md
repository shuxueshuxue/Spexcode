# Adversarial critique — protocol asset (pre-registered constraint set)

Provenance: final adversarial review of [[spec-reconstruction-bench]], authored by review session
`0a136898-ba93-4292-b916-a32c52bed366`（"[[iteration-bench]] 作为 spec reconstruction benchmark 的强势反方"）,
delivered 2026-07-14 via the session channel to worker `spec-reconstruction-bench-012b`, preceded by two
manager-relayed digests from session `17557c6a-4535-4291-8f73-61df0572ad77`. Copied verbatim (full final
note, then the two digests). This document is a **frozen input to the protocol**: the pre-registered gates
in `docs/spec-reconstruction-bench.md` §8 are the conditions under which this critique's null position
("benchmark 未识别 reconstruction") is overturned. Do not edit; supersede only by a new review round
recorded the same way.

---

## Final note（反方终稿，全文）

【spec reconstruction benchmark 最终反方 note】

结论：该 benchmark 只有在 reconstruction、历史沉淀价值、下游任务效用被拆成不同估计量时才可判别。否则它会把仓库线索复述、original 的历史优势、模块大小和 judge 审美混成一个总分。

1. 三尺度与三 estimand
- discovery：不知道节点存在时能否发现正确责任边界。
- content recovery：给定节点或模块脚手架后，能否恢复冻结快照中可证的独立承诺。
- downstream utility：候选 spec 是否帮助 fresh agent 完成隐藏未来任务。
leaf 保留父兄弟、id 或 inbound mentions 时，只能叫 body completion；若声称 discovery，必须连目标 id、入边、镜像摘要一起 scrub。module 保留外部 related/mentions 时同理，是 ontology completion。whole 只评 root/package/module，不能与 leaf/module 合成 scale 总分；单仓 whole 的 N=1 只做描述。

2. 泄漏与知识预算
必须明确两种条件：production-code-only 与 tracked-repo-without-spec/history。tests/docs 对前者是禁止信息，对后者是合法 repo evidence，不能看结果后改口称污染。
快照用 allowlist，不用不断加长的删除名单。隔离 clean HOME、无网络、仅一个只读 mount，并保存 open-path manifest。泄漏面包括 .git/object DB/其他 worktree、.spec、CLAUDE.md/AGENTS.md 及嵌套副本、.claude/.codex、plugin materialization、CLI help/prompt preset、源码注释和字符串里的 spec id/mention、tests/fixtures/snapshots、docs/reports/eval evidence、dist/source map/tarball、symlink、缓存与全局记忆。C0 树里 CLAUDE.md 是 tracked 文件，git archive 也会带上，不能因它今天被视为 generated 就假设自然消失。
污染 canary 必须成对：唯一且错误的 plausible requirement 只放在禁止 surface；clean arm 零复述；leak-positive twin 故意开放该 surface 后高复述，否则 canary 无检测力。

3. original 不是 oracle
O0 只是匿名 candidate arm。living spec 可能 stale、遗漏、抽象，且含单快照不可识别的历史 rationale。不得用 original 文本、taxonomy 或 embedding similarity 当答案键。主指标是独立 atomic fact 的 supported recall、unsupported/contradicted precision、责任和非责任边界、ownership/graph integrity、隐藏变更决策和下游任务结果。BLEU/ROUGE/embedding 只作污染诊断；异常高相似度应触发 leakage audit。

4. C0 historical time-split
严格冻结：
O0 = C0 当时的 native spec；
R0 = 仅从 C0 无 git、无 spec 隔离快照重建；
N0 = 同一 C0 repo 不给 spec。
三者评 C0 后真实 future episodes，不喂 HEAD spec 或任何 C0 后 spec 更新。future 分三层：
A artifact-identifiable：C0 allowed artifacts 已足以支持；
B original-only latent intent：C0 artifacts 没写，但 O0 已写；
C genuinely new request：到 future episode 才出现。
A 才能检验 reconstruction；A+B+C 检验 practical utility。O0 在 B 占优是历史沉淀的真实价值，不是 R0 可公平恢复的真值；若 pooled，会天然偏 O0 或被大量 C 稀释。

future agent 只见精确 pre-state 的无 git 快照、同一 sanitized issue request 和 O0/R0/N0 之一。目标 PR、diff、commit message、future tests/docs/reports withheld；acceptance 在沙盒外运行。backport/cherry-pick/revert/vendor/dependency-only 按 patch-id、trailer和盲审预先排除。C0 已有 tests/docs 是否预告 future，由不看 O0 的 annotators 在候选生成前标 identifiable/prefigured/latent。

选题框不得看 O0 是否覆盖、later spec 是否更新或哪个 arm 表现好。先冻结完整 eligible frame、exclusion reasons、抽样 seed、C0 和 horizon；按代码路径、行为 diff、issue 时间、可回放性和 task category 选择。whole 只用 module-level future：模块路由、责任边界、跨模块实现或 public interface 变化；不准用叶子 bugfix。outcome 是 affected-module P/R、scope violations、behavioral acceptance 和 regression。

5. 对 C0=038dce1f 与 1532 commits 的裁决
事实核查：038dce1f 是 2026-06-23 的 merge，subject 本身是 layout change 后的 yatsu re-measure，不是 release-tag 式外生 cutoff。到当前 HEAD 共 2125 commits，其中 1532 正是 non-merge commits、593 merges；first-parent 只有 798 transitions，其中 253 non-merge、545 merge，覆盖 22 个日期。故 1532 绝不是 1532 个独立 future tasks，也不是有效样本量。
C0 已有 .spec，但处于 .config plugin、spec-yatsu、yatsu.md、yatsu.evals.ndjson、needs-yatsu-eval 词汇期；窗口后来跨过 548a0386 的全树 yatsu→eval/spec-yatsu→spec-eval 迁移，以及后续 .plugins 多轮重排。这里至少有三重混杂：
- format drift：同一语义换文件名、node id、route 和领域词；
- episode clustering：一个 no-ff change 被 branch commits、merge commit、反复 re-measure 多次计数；
- task-selection freedom：1532 条中可任意挑出对 O0 有利的题。
裁决：038dce1f 可作 protocol pilot，但不能单独支撑 confirmatory 结论。primary pilot future horizon 应止于首次全树 vocabulary/schema migration 前；若坚持全 22 日窗口，必须预注册 pre-migration / migration / post-migration 三 epoch，按 first-parent merge/change episode 聚类，rename-only、re-measure-only 不作独立任务，跨 epoch 不 pooled。未来 prompt 用行为语言，不要求 agent 猜新旧术语；migration 本身若入样，只能作为单独的 format-adaptation stratum。确认性结果至少再用一个外生 C0 重复。

6. blind multi-judge
候选生成前冻结 atomic fact cards 和 future decision cards；original 不参与制 key。每个匿名 candidate 按 0-3 评：
supported facts、unsupported/contradicted claims、responsibility/non-responsibility、ownership/graph、future decision calibration。
至少 human domain judge 加两个不同模型族，均不知道 arm、顺序、original 文本和生成 prompt。逐 judge 报告 Gwet AC2 或 Krippendorff agreement 与 leave-one-judge-out；去掉任一 judge 排名翻转就不得给单一 consensus。下游 hidden-test pass、regression、scope、tokens 独立报告，不能用 judge 印象代替。

7. 最小有判别力 pilot
一个外生 C0；2 leaf、2 size-matched module、1 whole，共 5 次 R0 reconstruction。future task 6 个：每个 leaf/module 各 1，whole 2 个 module-level。O0/R0/N0 为 18 个主 arm runs。
两种负对照都跨三尺度各跑一次：
- polished near-miss：style/size/graph 像真的，但打乱一条 ownership 或责任边界；
- size-matched shuffled original。
因此总数是 18+6=24，不是 21。若只跑 21，就只能每尺度选一种 control，不能声称两种 control 均跨尺度验证。pilot 只判协议、泄漏、rubric 灵敏度、任务可回放性和 outcome 方差，不宣称 arm 胜负。module-size 记录 LOC/文件数/node数/深度/original facts/入边/测试文档量/耦合，按 module block 宏平均，不 micro-average。

8. 推翻反方立场的预注册门
- clean canary 零命中，leak-positive twin 高命中，open-path 无越界；
- near-miss 与 shuffled 显著低于真实 candidates，证明 rubric 非审美；
- O0 明显优于 N0，否则任务未证明 spec 有用；
- R0 在 A 类 future 上稳定优于 N0，并在预注册 margin 内对 O0 非劣，例如 task success 差不超过 10pp、module-impact F1 差不超过 0.10；
- 排名跨 judges、executors、module-size strata、至少两个 C0 稳定，且高分不伴随 original phrase overlap；
- whole 优势仅在 module-level future 上成立。
若 R0 只在 leaf completion 赢、controls 也高分、O0 与 N0 无差、排名随 judge 翻转、size 调整后消失，或 1532 commit 被当 iid 样本，我维持反方结论：benchmark 未识别 reconstruction。

---

## Manager-relayed digest, round 1（先行两组意见之一）

反方已回两组，必须并入预注册：1) 三尺度分开 estimand/报告，禁止总分或 scale curve。保留父兄弟的 leaf 诚实名为 leaf completion，不声称 discovery；module 是 subtree/ontology completion；whole 才评 coarse root/package/module discovery，N=1 只作 case study。2) original 不是 oracle，只是匿名 arm；原文事实只评分 C0 snapshot 可独立支持的 atomic facts，主指标仍 future utility。3) primary knowledge budget 建议 tracked-repo-without-spec/history；production-code-only 只做小负对照，tests/docs 是否可见预注册。4) C0=038dce1f 在旧 .config/yatsu 词汇期，必须避免把格式迁移当 arm 差异：要么选 schema-stable C0，要么把三臂统一投影/注入到中性 artifact surface；不要一臂 native old format、一臂 current .spec。5) future shingle canary 只门禁 reconstruction generation snapshot/prompt；评测阶段的 future task prompt 本来就可含新需求，不能误杀。6) 1532 commits 先冻结成 semantic task blocks，排除 merge/generated/spec-only，不 micro-average。把反方完整 critique 作为 protocol asset。

## Manager-relayed digest, round 2

反方 5/5 已齐，预注册硬门请全部吸收：O0/R0/N0 frozen time-split；future strata A=artifact-identifiable、B=O0-only latent、C=new requirement，A用于 reconstruction claim、A+B+C仅 practical utility；selector不看O0/later spec/arm结果，按first-parent semantic episodes、外生C0/seed；future pre-state也导出无.git并剥离 intervening spec，目标diff/message/tests/docs withheld；whole只跑module routing/boundary/cross-module tasks；original匿名arm非oracle；human+2异族judge、逐judge/LOO/agreement；near-miss与shuffled original controls，id skeleton可选。pilot主arm 6 tasks×3=18；若两种control跨三尺度各1则总24（不是21）。C0旧词汇必须三臂同native format或中性注入，禁止格式混杂。完整 eligible frame/exclusion reason/open-path/leak-negative+positive twin归档。
