---
concern: materialize may have stopped emitting the .codex/hooks.json gitignore line [[harness-delivery]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: harness-delivery
created: 2026-07-02T14:22:34.171Z
---

Observed by the a-knife worker (a073bc59) in its worktree: the session-start materialization regenerated the managed gitignore block WITHOUT the '.codex/hooks.json' line, leaving .gitignore dirty against main (which still carries the line). The worker correctly discarded the churn rather than riding it into board-lean's merge. Open question for the toolchain lane: did materialize genuinely stop emitting that entry (behavior change — then main's canonical block is stale and should be regenerated once, centrally), or is it context-dependent (e.g. only emitted when a codex harness is configured — then per-worktree regeneration fighting main's block is the bug)? Either way the managed block should not oscillate per worktree. Repro: fresh session worktree on this repo, check git status of .gitignore after start.
