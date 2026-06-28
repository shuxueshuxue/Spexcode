---
title: harness-session-id
surface: hook
status: active
hue: 200
code:
- .spec/spexcode/.config/core/harness-session-id/harness-session-id.sh
events:
- SessionStart
- UserPromptSubmit
order: 5
block: false
---
Capture Codex's native thread id onto the governed record, so delivery and resume can target the right thread.
Codex mints an unpinnable thread id, but on a **per-session** app-server socket the visible TUI's own thread is
the only one loaded — so the adapter reads it deterministically via `spex codex-thread <sock>` (a
`thread/loaded/list` on the session's own socket): no rollout-file scan, no cwd guess. The hook re-fires until
the TUI has booted its thread, then stores the id as `harness_session_id` through `spex session harness-id`.
Claude needs none of this — its pinned id already is the record id. The dispatcher stays a dumb manifest runner;
the harness-specific socket path and capture stay behind `harness.sh` and the adapter boundary.
