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
