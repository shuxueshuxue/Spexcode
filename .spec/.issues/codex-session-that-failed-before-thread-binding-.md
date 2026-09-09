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
