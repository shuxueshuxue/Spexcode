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
switches to the new session. An existing session shows its **live tmux terminal** (SessionTerm) with the
input docked at the bottom.

The terminal is a **real tmux client**, not an output tap. SessionTerm opens an xterm wired to one
**WebSocket** (`/api/sessions/:id/socket`) that the backend bridges to a genuine `tmux attach` client
(see the `sessions` node's `pty-bridge`). That one socket carries everything: server→client is raw pane
bytes (binary) written straight to xterm with **no clear**, and client→server is raw terminal input
(binary — keystrokes **and** mouse) plus a single text control frame (`{t:'resize',cols,rows}`). Because
the browser is a true tmux client, the **mouse wheel scrolls the actual tmux pane history** (copy-mode) —
you operate it like real tmux, not a reconstructed buffer. There is **no snapshot-plus-raw-delta splice**
(the old scramble): a newly-joined viewer is seeded once with the current screen and then streams live
from the same coherent client. The terminal **scales to its panel** — the FitAddon fits xterm to the
container and each fit sends the new cols×rows over the socket so tmux re-renders at exactly that size
(only when it changed). The panel clips horizontally; the xterm viewport is the only scrollbar.

Switching tabs is **instant** and never loses your place: every session terminal you've opened stays
**mounted but hidden** (its WebSocket and scroll position survive), and the backend keeps a **warm tmux
client** per live session, so first-open and re-open both paint immediately instead of cold-starting a
capture + spawn chain. List navigation is handled at the **window** level so arrows keep walking the list
regardless of what holds focus (xterm included), and the selected tab persists across open/close.
Lifecycle actions (relaunch / request-review / merge / back-to-working / close) sit in the header per the
session's state; an offline session shows a relaunch panel instead of a dead terminal. SessionWindow is
the read-only glance: every session with its status dot and pending-op count, click to highlight that
worktree's overlays on the board (and focus its first changed node).

`SessionInterface.jsx` is the `Enter` modal: `order = ['new', ...session ids]` with `active` clamped to
a real tab. The New tab prefills a `@${focusId}` reference (keyed on `focusId`, not the focus object, so
board polling can't wipe typing) and submitting POSTs `/api/sessions` then switches to the returned id.
An existing tab renders a **persistent stack** of `SessionTerm`s — one per session you've opened, only the
active one shown — over the offline relaunch panel when the active session is `offline`; the docked `❯`
textarea's Enter still forwards a whole line to `POST /api/sessions/:id/keys` (raw keystrokes also go
straight down the socket). The header buttons map to the session's status (relaunch / review / merge /
back-to-working / close), each a thin POST then a board reload. A window-level capture listener owns
`↑`/`↓` list movement and Enter-on-New. `SessionTerm.jsx` opens a FitAddon-sized xterm, fits it to the
panel on open and on container/window resize (sending the new cols×rows only when it changed), and wires
xterm to the session WebSocket: incoming binary frames are written straight to xterm, and `term.onData`
(keystrokes + mouse) is sent back as binary. `SessionWindow.jsx` is the top-right floater of status-dot
rows with a pending-op glyph count, highlighting a worktree's overlays on pick and opening the interface
on open. All of this renders only what `/api/board` reports — no session logic lives in the dashboard —
so the raw source (a thin view identical to `spex board`) holds.
