---
concern: worktree materialize strips the managed ignore block from the TRACKED .gitignore while the main checkout keeps it — with no explicit render vote (default: ignored) the block's home should be the tracked .gitignore; observed as a surprise ' M .gitignore' on a node worktree (block moved to the shared .git/info/exclude, which seeding already populates). Either the worktree render pass resolves a different policy than main's, or the erase phase prunes a home it shouldn't. Repro: dispatch a worktree on this repo, let the hook gate re-render, git diff .gitignore.
by: 1a47519f-6024-419d-ac56-4814e289b86a
status: open
nodes: render-policy
created: 2026-07-11T10:13:00.737Z
---

(no detail given — worktree materialize strips the managed ignore block from the TRACKED .gitignore while the main checkout keeps it — with no explicit render vote (default: ignored) the block's home should be the tracked .gitignore; observed as a surprise ' M .gitignore' on a node worktree (block moved to the shared .git/info/exclude, which seeding already populates). Either the worktree render pass resolves a different policy than main's, or the erase phase prunes a home it shouldn't. Repro: dispatch a worktree on this repo, let the hook gate re-render, git diff .gitignore.)
