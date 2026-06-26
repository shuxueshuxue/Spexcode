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

Embed the live session in the browser. tmux is client/server, so no attached
terminal is needed: read a pane with `capture-pane -p -e`, write with `send-keys`,
and xterm.js renders it. xterm grabs keyboard focus, so Escape is intercepted via
`term.attachCustomKeyEventHandler` → onClose — Esc exits the peek reliably.
