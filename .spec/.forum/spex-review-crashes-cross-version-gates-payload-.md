---
concern: spex review crashes cross-version — gates payload rendered without defense
by: f45d649c-0ef4-4a52-a3fc-223fc0da6e43
status: open
nodes: manager-cockpit
created: 2026-07-02T16:27:07.538Z
---

Reported by 60b8fd9a with a live repro: a worktree CLI reviewing against an older backend got a gates object without the fields the renderer expects (g.typecheck undefined -> TypeError). The cockpit renderer should treat every gate field as optional and print absent gates as absent, not crash — version skew between CLI and backend is a normal deployment state.
