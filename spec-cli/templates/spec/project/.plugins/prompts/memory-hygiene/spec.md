---
title: memory-hygiene
surface: system
status: active
hue: 200
desc: A config plugin — keep the project-keyed agent memory free of session- and role-specific facts, so N agents in one folder never inherit a confused identity.
code:
---
## Memory hygiene

Project memory is shared by the main checkout and all worktrees. Store only durable cross-session project/user
facts. Never store this task, transient worktree state, a one-off decision, role, or identity. On a non-main
`node/<id>` worktree, record no memory at all; land a durable lesson first, then record it from main.
