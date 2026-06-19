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

## raw source

`Enter` on the board opens the session interface; the always-on top-right window is the at-a-glance
summary. Both are thin views of the backend's session state — the dashboard renders whatever
`/api/board` (i.e. `spex board`) reports, so a human watching the dashboard and an agent driving the
same sessions through the CLI see identical state. The dashboard never invents session state.

## expanded spec

The interface is two panes: a left session list and a right content area that **morphs** by what's
focused. "New Session" shows a centered avatar + input, prefilled with the focus node as an editable
`@node` reference (a convenience — a session may touch any nodes, so the prefix is deletable); launching
switches to the new session. An existing session shows its **live tmux terminal** (SessionTerm streams
the pane over SSE and forwards keystrokes) with the input docked at the bottom. The stream is an
**incremental raw byte feed**, not a screenshot poll: the backend hooks the pane's raw output
(`tmux pipe-pane` → a per-session temp file, ref-counted across viewers) and each SSE connection sends a
single opening snapshot (the current screen, so a fresh connect isn't blank) then tails the file by byte
offset, pushing only the new bytes (ANSI + cursor moves, base64'd). The client writes those deltas
straight to xterm with **no full-screen clear**, so xterm is the emulator: no flicker, keystrokes echo at
stream latency rather than a fixed tick, and **scrollback accumulates** (the xterm viewport scrolls
through history). The terminal **scales to
its panel**: xterm has no fixed size — the FitAddon fits it to the container, and each fit POSTs the
resulting cols×rows to `POST /api/sessions/:id/resize` so tmux re-renders the detached pane at exactly
that size. The panel clips horizontally; the xterm viewport carries the only (vertical) scrollbar, so the
TUI lines up at whatever size the panel happens to be with no double scrollbar. List navigation is
handled at the **window** level so arrows keep walking the list regardless of what holds focus (xterm
included), and the selected tab persists across open/close. Lifecycle actions
(relaunch / request-review / merge / back-to-working / close) sit in the header per the session's state;
an offline session shows a relaunch panel instead of a dead terminal. SessionWindow is the read-only
glance: every session with its status dot and pending-op count, click to highlight that worktree's
overlays on the board (and focus its first changed node).

`SessionInterface.jsx` is the `Enter` modal: `order = ['new', ...session ids]` with `active` clamped to
a real tab. The New tab prefills a `@${focusId}` reference (keyed on `focusId`, not the focus object, so
board polling can't wipe typing) and submitting POSTs `/api/sessions` then switches to the returned id.
An existing tab renders `SessionTerm` (or the offline relaunch panel when status is `offline`) with a
docked `❯` textarea whose Enter forwards to `POST /api/sessions/:id/keys`; the header buttons map to the
session's status (relaunch / review / merge / back-to-working / close), each a thin POST then a board
reload. A window-level capture listener owns `↑`/`↓` list movement and Enter-on-New. `SessionTerm.jsx`
opens a FitAddon-sized xterm (scrollback enabled), fits it to the panel on open and on container/window
resize (re-POSTing the new cols×rows to `/api/sessions/:id/resize` only when the fitted size changed),
subscribes to `/api/sessions/:id/stream` (SSE), and writes each base64 frame's decoded bytes straight to
xterm with no clear. `SessionWindow.jsx` is the top-right floater of status-dot rows with a pending-op glyph count,
highlighting a worktree's overlays on pick and opening the interface on open. All of this renders only
what `/api/board` reports — no session logic lives in the dashboard — so the raw source (a thin view
identical to `spex board`) holds.
