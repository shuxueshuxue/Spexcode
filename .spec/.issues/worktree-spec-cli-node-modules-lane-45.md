---
concern: 派发出来的 worktree 缺 spec-cli/node_modules 软链，于是每条 lane 跑全量测试都看到 45 条与产品无关的红
by: da103a36-07c4-4e77-9d85-006462ae68b8
status: open
nodes: packaging
created: 2026-07-31T05:37:02.434Z
---

Spec: packaging

## 实测

派发出来的 worktree，Node 22（显式钉住版本）：

    补软链前   552 tests · 507 pass · 45 fail
    补软链后   552 tests · 551 pass ·  0 fail

失败签名（每一条都一样）：

    error: 'spawnSync /home/jeffry/spexcode/.worktrees/<wt>/spec-cli/node_modules/.bin/tsx ENOENT'
    code:  'ENOENT'
    stack: Object.spawnSync → execFileSync → spex (init.test.ts:53)

原因：测试台会 spawn `spec-cli/node_modules/.bin/tsx` 作为子进程来跑真实 CLI，而 **git worktree 天生不带 `node_modules`**。惯例是手工软链主检出的那一份，但通常只软链了**包根那一层**，`spec-cli/node_modules` 被漏掉——于是所有 spawn 子进程的测试（init / doctor / adoption / lint rig …）整片变红。

补上 `ln -s <主检出>/spec-cli/node_modules spec-cli/node_modules` 之后全绿，同一棵树、同一个 Node。

## 为什么这条比它看起来重要

**它在教每一条 lane 把红当常态。** 45 条红是任何一条派发 lane 跑全量测试时的默认景象，于是"既有失败、不是我引入的"成了标准转述——我自己就把它写进过 `agent-node-24-nvmrc-22-lane` 当论据，而那是错的归因（那条 issue 真正对应的幻影只有 **1** 条，是明写的 Node 版本闸门）。

一个把 45 条红当背景噪声的环境里，**一条真红不会被任何人分辨出来**。本仓已经付过这个代价：`content batch: spawn failure is loud` 在 trunk 上红了很久、被反复归入"既有失败"，bisect 之后是真缺陷（负 errno 覆盖了 spawn 错误的字符串 code），波及全仓七处判据、其中五处只在 git 缺失/不可执行的机器上可达——它的守卫红着，被守的东西自然没人发现（已由 `85c6fed6` 修复）。

## 修法方向（未实施，属提案）

1. **worktree 创建时把各包的 `node_modules` 一并软链**，而不只是包根那一层。这是最像"改一处、若干处红自己消失"的一条。
2. 或者让测试台在 `.bin/tsx` 缺失时**响亮报出修复指令**（"link <path> from the main checkout"），而不是抛一个看不出原因的 ENOENT——ENOENT 的堆栈里只有 spawnSync，读的人无从知道缺的是软链。

**不要**的修法：在测试里 try/catch 掉 spawn 失败，或把这些测试标 skip。那会把一个可修的环境缺陷变成静默，而这些测试恰恰是唯一驱动真实 CLI 子进程的那批。

## 相邻但不同

- `agent-node-24-nvmrc-22-lane`：派发环境 Node 24 vs 仓库钉 22。**只影响 1 条** rig(明写版本闸门)，与本条是两个独立的环境问题，我曾错误地把两者并成一个，已在那条 issue 里订正。
- `github#75`(pty-bridge 环境性失败)、`codex-launch-harness-test-ts-…`(断言漂移)：同属"trunk 上长期红"这一族，但各自修法不同，不要合并处理。

<!-- reply: da103a36-07c4-4e77-9d85-006462ae68b8 @ 2026-07-31T05:55:40.916Z -->
**保持开启**——本 session 只在自己的 worktree 里补了软链验证了因果，没有修根因。

已确证的因果：补上 `spec-cli/node_modules` 软链后，同一棵树、同一个 Node 22，从 `552 · 507 pass · 45 fail` 变为 `552 · 551 pass · 0 fail`；失败签名全是 `spawnSync .../spec-cli/node_modules/.bin/tsx ENOENT`。

根因未修：**每一条新派发的 worktree 仍然会缺这个软链**，所以下一条 lane 跑全量测试照样看到 45 条与产品无关的红。修法要落在 worktree 创建路径（把各包的 `node_modules` 一并软链），或落在测试台（缺失时响亮报出修复指令，而不是抛一个只有 spawnSync 堆栈、看不出缺什么的 ENOENT）。

留开的理由不只是"没修"：**它是本仓"红被常态化"这个损失信号污染源里影响面最大的一条**（45 条 vs Node 版本那条的 1 条），而本仓已经为此付过代价——`content batch: spawn failure is loud` 红了很久被反复归入"既有失败"，bisect 后是真缺陷（已由 85c6fed6 修复、issue 已关）。
