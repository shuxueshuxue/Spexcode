---
concern: 测试套件在非 ASCII 路径的 worktree 里必然失败，而产品自己就会生成中文 worktree 名
by: abe9f2bd-3e85-4083-a152-0d89f267521b
status: landed
nodes: code-anchor
created: 2026-07-26T16:23:09.312Z
---

(no detail given — 测试套件在非 ASCII 路径的 worktree 里必然失败，而产品自己就会生成中文 worktree 名)

<!-- reply: abe9f2bd-3e85-4083-a152-0d89f267521b @ 2026-07-26T16:23:48.388Z -->
## 现象

`spec-cli` 的测试套件在**路径含非 ASCII 字符**的 worktree 里必然失败一项:

    ✖ concurrent different-tip builders share an atomic ledger and recover on reopen
    Error: cache child exited 1
    Error [ERR_MODULE_NOT_FOUND]: Cannot find module
      '/home/jeffry/spexcode/.worktrees/%E7%8E%B0%E5%9C%A8...-abe9/spec-cli/src/git.ts'

路径被百分号编码后当成字面文件名去解析。来源是 `spec-cli/src/git.test.ts:103` —
测试 `spawn(process.execPath, [tsx, '-e', child, ...])` 起子进程,子进程里的 import 路径经过
URL 编码,而接收端按字面路径解析。

## 为什么这不是边角情况

**SpexCode 自己就会生成中文 worktree 名** —— worktree 目录由 session 提示词派生,中文提示词
就得到中文目录。也就是说:**任何由中文提示词派发出去的 worker,在自己的 worktree 里跑
`npm test` 都会看到一条假的失败**。运气不好它会去"修"一个根本没坏的东西,或者反过来,
把这条红当背景噪音,从而对真实的红失去敏感。

## 对照实验(已做,结论确定)

    纯 main dc76dd4b 放在 /tmp/pin-main-test(ASCII)      → 32 pass / 0 fail,3 次全过
    纯 main dc76dd4b 放在 /tmp/中文目录-test(非 ASCII)   → 31 pass / 1 fail
    带我 2 个 spec 提交的树,目录名为中文                  → 31 pass / 1 fail,3 次全败

三组的 `git.ts` 与 `git.test.ts` 逐字节相同。**唯一变量是目录名的字符集。**

## 范围

我在 `spec-cli/src` 的非测试文件里没有找到 `pathToFileURL` / `file://` 这类模式,所以目前
判断为**测试夹具缺陷,不是产品缺陷**。限于我查过的范围,其他包未查。

## 附带发现

CI(`.github/workflows/ci.yml`)跑的是 `npm ci` / `npm run lint` / `tsc --noEmit` /
`dead-words` / `clean-init-smoke` —— **不跑单元测试**。所以另有一条既有失败
(`init → materialize → uninstall forgets every derived artifact`,在纯 ASCII 的 main 上
也是 428 pass / 1 fail)一直没被 CI 发现。这一条另计,不在本 issue 范围内,但同样需要处理。

Spec: code-anchor
