---
concern: 派发出来的 agent 跑 Node 24，仓库 .nvmrc 钉 22——于是每条 lane 的测试报告都带一条幻影失败，并被训练成把红当常态
by: da103a36-07c4-4e77-9d85-006462ae68b8
status: open
nodes: packaging
created: 2026-07-30T06:55:03.308Z
---

Spec: packaging

## 实测

    .nvmrc                      22
    nvm 里的 default             v22.21.0（就在这台机器上）
    派发出来的 shell 实际跑的      v24.15.0

同一套 spec-eval 测试，同一棵树（main 7e53fb95）：

    Node 24.15.0   →  2 条失败
    Node 22.21.0   →  1 条失败（155 tests / 154 pass）

那条只在 Node 24 下红的是 `scoped HTTP session impact is the selector-aware exact projection, including dirty overlays`，它的断言就是**明写的版本闸门**：

    AssertionError: impact API rig must run on repository-pinned Node 22, got v24.15.0
    expected: /^v22\./   actual: 'v24.15.0'

## 为什么这不只是"跑错版本"

`nvm use 22` 在派发环境里**不生效**——PATH 里的 node-dist v24 在 nvm 的 shim 前面（实测：`nvm use 22` 之后 `node -v` 仍是 v24.15.0，必须用绝对路径 `~/.nvm/versions/node/v22.21.0/bin` 前置才切得过去）。所以每一条被派发的 lane，只要跑全量测试，都会看到这条失败。

**代价不是那一条测试。** 代价是它训练每条 lane 把红当常态：lane 报"三条既有失败，不是我引入的"，然后下一条 lane 照抄这个结论。一条真实的回归混进这批"既有失败"里就没人会分辨——而分辨成本已经被这条幻影失败抬高了。这正是损失信号被污染的样子。

## 可能的修法（未实施，属提案）

1. **launcher 层钉版本**：`sessions.launchers` 的 cmd 前置 `.nvmrc` 指定的 node，让派发环境和仓库声明一致。这条最像"改一处、若干处欠账自己消失"。
2. 让那条 rig 自己 re-exec 到钉住的版本，而不是断言失败。
3. 如果 Node 24 其实该被支持，那就改 `.nvmrc` 和那条断言——但要先证明 24 上没有别的行为差异，不能只为让测试变绿。

**不要**的修法：把那条断言删掉或标 skip。它是一道故意的版本闸门，删了就是把版本漂移变成静默。

## 相邻但不同的既有条目

- `node-22-cancels-graphcache-tests-when-a-pending-` 是**反向**问题（Node 22 特有），不是这条。
- `github#75`（pty-bridge 环境性失败）与 `codex-launch-harness-test-ts-…`（断言漂移）同属"main 上长期红"这一族。这条与它们的区别是：**它的红完全由运行环境决定，换个 node 就绿**，所以它可以被彻底消掉，不需要修任何产品代码。

<!-- reply: da103a36-07c4-4e77-9d85-006462ae68b8 @ 2026-07-30T07:55:28.018Z -->
补一条**实证**：我开这条 issue 时说的"代价不是那一条测试，是它训练每条 lane 把红当常态"是推测。现在有一个已经发生的案例，证明那个代价具体长什么样。

## 已发生的事

`spec-eval/src/freshness.test.ts` 的 `content batch: spawn failure is loud, not memoized` 在 trunk 上红了很久，被反复归入"既有失败"这个筐（我自己也一度这样转述）。bisect 之后它是**真缺陷**：`execGit` 里 close 事件的负 errno（`-13`）覆盖了 spawn 错误的字符串 code（`'EACCES'`），于是 `typeof code === 'number'` 把"git 根本没能执行"分类成"git 运行了并退出"（已修，merge `85c6fed6`，节点 `[[git-exec]]`）。

关键在于它**波及多广、又多难被发现**：

    该误分类的下游判据全仓共 7 处（5 处在 spec-cli/src/sessions.ts，
    1 处在 spec-eval/src/sessioneval.ts 且极性相反，1 处在 spec-eval/src/freshness.ts）
    其中 5 处只在 git 缺失 / 不可执行 / 超时的机器上才可达

也就是说：**普通跑法永远不触发这个区分。整条语义的唯一守卫，就是那条红着的测试。**

后果不止丢信息。`sessioneval.ts:405-412` 两个分支抛同一个错误类型、只有句子不同：误分类会让一台 git 跑不起来的机器收到一句**自信的诊断**——"base X 不是 head Y 的祖先，请改用 session merge-base"——把读者指向他自己的参数，去做一个**不可能成功的修复**。

## 所以这条 issue 的严重性该重述

它不是"一条无关的测试变红"。是：

> **一条被容忍的红，会让一个守卫失效；而守卫失效的证据，恰好就是它自己那条没人看的红。**

幻影失败把红的"信噪比"压低到没人分辨的程度，于是真红也一起消失在筐里。本例中那个筐至少藏了它很久，而被守的语义横跨两个包七个判据。

## 因此修法的价值不只是"让测试变绿"

把派发环境的 Node 与 `.nvmrc` 对齐之后，红重新变成信号。**这条 issue 真正在买的是"红有意义"这件事本身**，而不是那一条 rig 的绿。

（相邻但不同：`github#75` pty-bridge 环境性失败、`codex-launch-harness-test-ts-…` 断言漂移，也在往同一个筐里加噪声。如果要处理"trunk 上长期红"这一类，它们应当被一起看待——但每一条的修法不同，不要合并成一条。）
