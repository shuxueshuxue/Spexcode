---
title: session-console
status: active
hue: 280
desc: The Enter surface — two-pane session interface with a live tmux terminal.
code:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionTerm.jsx
---

# session-console

Pressing `Enter` on the board opens the session interface: two panes, a left session list and a right
content area that morphs by what's focused. "New Session" shows a centered avatar + input prefilled
with an editable `@node` reference (a convenience — a session may touch any nodes); launching switches
to the new session. An existing session shows its **live tmux terminal** (SessionTerm streams the pane
over SSE and forwards keystrokes) with the input docked at the bottom. List navigation is handled at the
window level so arrow keys keep working regardless of focus, and the selected tab persists across
open/close. Lifecycle actions (relaunch / request-review / merge / back-to-working / close) sit in the
header per the session's state; an offline session shows a relaunch panel instead of a dead terminal.

SessionWindow is the always-on top-right glance: every session with its status dot and pending-op
count, click to highlight that worktree's overlays on the board. Both components render whatever
`/api/board` (i.e. `spex board`) reports — the dashboard is a thin wrapper; an agent driving the same
sessions through the CLI sees the identical state.
