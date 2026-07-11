---
title: memory-hygiene
surface: system
status: active
hue: 200
desc: A config plugin — keep the project-keyed agent memory free of session- and role-specific facts, so N agents in one folder never inherit a confused identity.
code:
---
## Memory hygiene — keep the shared store identity-clean

SpexCode's agent memory is keyed by the **main project**, so every agent running under this project — the main checkout AND every worktree — reads the **same** memory. That makes session- and role-specific facts toxic: one agent's note silently becomes every agent's belief. So, when deciding whether to record a memory:

- **Never record session-specific content** — this task, this worktree's transient state, a one-off decision, who you're talking to right now. Memory is ONLY for durable, cross-session project/user facts.
- **On a non-main worktree** (you are on a `node/<id>` branch, not the main checkout): do **not** record any memory for this session at all. Its work is transient and will merge or close; a durable lesson is recorded later, from main, once it has actually landed.
- **Even on main, never record a transient ROLE or IDENTITY** — "I am the supervisor", "I'm the coordinator", "I'm the agent doing X". These are per-launch facts, not durable ones. Recording one makes the next launched agent read *itself* as that role, and several agents in one folder dissolve into mutual-supervision confusion (everyone thinks they're the supervisor, everyone watches everyone).
