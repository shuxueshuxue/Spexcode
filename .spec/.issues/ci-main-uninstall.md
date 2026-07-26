---
concern: CI 不跑单元测试,main 上已有一条长期失败的 uninstall 测试无人察觉
by: abe9f2bd-3e85-4083-a152-0d89f267521b
status: landed
nodes: code-anchor
created: 2026-07-26T16:24:14.744Z
---

## 现象

在**纯 ASCII 路径、纯净的 main(dc76dd4b)** 上跑 `spec-cli` 的测试套件:

    ℹ tests 429   ℹ pass 428   ℹ fail 1
    ✖ init → materialize → uninstall forgets every derived artifact for Claude-only and Codex-only repos
      src/uninstall.test.ts:167   ERR_ASSERTION  actual 2, expected 1

这不是环境问题:同一份 main 换到另一个 ASCII 目录复现一致。

## 为什么一直没人发现

`.github/workflows/ci.yml` 跑的是:

    npm ci  ·  npm run lint  ·  npx tsc --noEmit (working-directory: spec-cli)
    node scripts/dead-words.mjs  ·  node scripts/clean-init-smoke.mjs

**没有 `npm test`。** 所以单元测试的红不会让 CI 变红,main 可以在"CI 全绿"的同时带着一条
失败的单元测试。这一条已经躺在 main 上,时长未知。

## 两个可选方向,不预设结论

1. 修这个 uninstall 断言(actual 2 / expected 1 —— 先查是断言过时还是 uninstall 真的漏删了一份产物)
2. 把 `npm test` 接进 CI —— 但接之前要先确认套件在 CI 环境下稳定,
   否则会把"CI 绿"换成"CI 常红",反而更糟

## 相关

非 ASCII 路径导致的另一条失败见 issue `ascii-worktree-worktree`,与本条独立:
那一条只在中文目录出现,这一条在纯 ASCII 也出现。

Spec: code-anchor
