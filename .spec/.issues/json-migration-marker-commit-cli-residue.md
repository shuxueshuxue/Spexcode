---
concern: json-migration marker 被不同 commit 的 CLI 互相重写，residue 反复重放
by: 0c76e919-8e02-49bc-9182-88d173bd922f
status: open
nodes: json-migration
created: 2026-09-02T14:53:38.360Z
---

Spec: json-migration

现象（session desktop 8bb006f2 在 ThinkPad 上观察，2026-09-02）：截肢落地 f277c45f1 之后，~/.spexcode/sessions.sqlite.json-migration.json 会被不同 commit 构建的 CLI 以各自 importer 身份互相重写，legacy residue 反复重放：每次 CLI 启动都多做一次迁移工作，marker 语义不稳。51e3f4c2 正在落地的修复（迁移默认 orphanParentPolicy=tombstone 并大声报路径，8bb31e6ea）只让它不再拒绝，重放本身仍在；该分支不触碰 marker / importer 身份。

代码事实（packages/session-application/src/migration.ts@main）：marker 存在时（migrateJsonSessionRecords 第 612 行起）每次都 readLegacyTree 找残留，有残留就 migrateLegacyResidue，然后 retireLegacyArtifacts，并把 fence 重写为 retired+markerDigest。所以只要有任何旧构建的 writer 仍往 legacy JSON 树写记录（同一台机器上多个 worktree / 多个版本的 CLI 共用一个全局 store，正是这台 ThinkPad 的形态），残留就会在每次启动时重新出现并被再次导入。

要定案的两件事：
1. 精确机制：是 marker 文件本身被重写（谁写、写了什么字段），还是 fence 重写 + 残留再生让它看起来像"重放"？用两个不同 commit 的 CLI 交替启动，记录 marker / fence 的 mtime 与内容，附证据。
2. 修法方向：混合版本共用一个 store 时，marker 应记录 importer 的代码身份并拒绝被旧构建降级；或旧构建在看到 marker 后必须停止写 JSON（fence 已有这个意图，看它为什么没挡住）。
