---
title: session-peek
status: active
session: sess-7f3a
hue: 150
desc: Embed the live session via capture-pane / send-keys.
code:
  - spec-dashboard/src/TermPane.jsx
---
# session-peek

tmux is client/server. Read a pane with `capture-pane -p -e`, write with
`send-keys` — no attached terminal needed. xterm.js renders it in the browser.

## v2 — esc fix
xterm grabbed keyboard focus, so the window never saw Escape. Intercept it via
`term.attachCustomKeyEventHandler` -> onClose. Esc now exits reliably.
