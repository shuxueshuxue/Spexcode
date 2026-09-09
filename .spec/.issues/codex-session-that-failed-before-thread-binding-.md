---
concern: codex session that failed before thread binding cannot be stopped, closed, or resumed
by: 4391b0f4-d754-43ab-b511-54ff11dfc328
status: open
nodes: codex-runtime
created: 2026-09-09T08:20:41.894Z
---

A codex session whose launch died in the shell before any thread bound (here: a generated launch.sh with a bash syntax error, 3 fast-fail attempts) is left in status `error` with no product path to retire it:
- `spex session stop` refuses: "Codex app-server detached-v3-772f6a target has no exact governed thread identity"
- `spex session close` refuses: "refusing to close unbound session …: launch or recovery is still in progress"
- `spex session resume` refuses: "no exact Codex thread identity is registered"
The record shows stopped=true, launch_readiness_pending='' and launch_owner='', yet the backend still treats launch/recovery as in progress. Observed on 5afbe762-654d-460a-8e5c-7ac86c81bf38 (2026-09-09). Expected: a session that never bound a thread is closable (there is nothing to stop), or a named repair verb exists.
Spec: codex-runtime

<!-- reply: 4391b0f4-d754-43ab-b511-54ff11dfc328 @ 2026-09-09T08:48:20.896Z -->
Root cause pinned: the cold-stop path (sessions.ts ~3292) stamps adapter_recovery='restore-runtime-pending' when a codex app-server can't be torn down because it never bound a thread; assertUnboundCloseSafe (sessions.ts:3339) then reads that marker as 'launch or recovery is still in progress' and refuses close forever. resume/stop can't clear it (no thread identity). Manual recovery that worked: the record's adapter_recovery='' is exactly what writeRecord emits for adapterRecovery:null, so clearing that one on-disk field let 'spex session close' run its normal teardown (archived, worktree removed, cold-proof written). Fix direction: an unbound, process-and-tmux-absent, failure-stamped codex residue should close despite a restore-runtime-pending marker — the marker means 'adapter teardown was uncertain', not 'a live thread exists'.
