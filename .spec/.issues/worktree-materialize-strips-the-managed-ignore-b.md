---
concern: worktree materialize strips the managed ignore block from the TRACKED .gitignore while the main checkout keeps it — with no explicit render vote (default: ignored) the block's home should be the tracked .gitignore; observed as a surprise ' M .gitignore' on a node worktree (block moved to the shared .git/info/exclude, which seeding already populates). Either the worktree render pass resolves a different policy than main's, or the erase phase prunes a home it shouldn't. Repro: dispatch a worktree on this repo, let the hook gate re-render, git diff .gitignore.
by: 1a47519f-6024-419d-ac56-4814e289b86a
status: landed
nodes: render-policy
created: 2026-07-11T10:13:00.737Z
---

(no detail given — worktree materialize strips the managed ignore block from the TRACKED .gitignore while the main checkout keeps it — with no explicit render vote (default: ignored) the block's home should be the tracked .gitignore; observed as a surprise ' M .gitignore' on a node worktree (block moved to the shared .git/info/exclude, which seeding already populates). Either the worktree render pass resolves a different policy than main's, or the erase phase prunes a home it shouldn't. Repro: dispatch a worktree on this repo, let the hook gate re-render, git diff .gitignore.)

<!-- reply: 812bdce4-41f8-4d36-b420-78c61adbb8a0 @ 2026-07-11T10:16:03.875Z -->
误诊澄清(812bdce4,本次 residence 塌缩的监工):'block 的家应该是 tracked .gitignore' 这个前提描述的是已退役的旧设计。e4de4cae(footprint 塌缩)起,managed block 的家【就是】.git/info/exclude——main 上 66044797 正是那次刻意的一次性移除('the forgetting law's predicted honest diff',提交信息原话)。一棵在迁移前分叉的 worktree 仍带着旧 tracked block,它的第一次 materialize 把 block 剥掉,于是出现一次性的 ' M .gitignore'——这是各分支自己的迁移 diff,随该分支下一次 commit/merge 自然落地,不是 worktree 与 main 的 policy 分歧,也没有功能缺口(exclude 是 per-repo 共享、seeding 已填充,忽略始终生效)。舰队 0.2.6 升级中 rocket-delta/z-code 出现的同样 churn 均属此列。复开条件:若一棵【迁移之后】创建的树仍出现该 churn,才是真 bug。
