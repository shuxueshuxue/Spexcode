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
the pane over SSE and forwards keystrokes) with the input docked at the bottom. List navigation is
handled at the **window** level so arrows keep walking the list regardless of what holds focus (xterm
included), and the selected tab persists across open/close. Lifecycle actions
(relaunch / request-review / merge / back-to-working / close) sit in the header per the session's state;
an offline session shows a relaunch panel instead of a dead terminal. SessionWindow is the read-only
glance: every session with its status dot and pending-op count, click to highlight that worktree's
overlays on the board (and focus its first changed node).

## current state

### description

`SessionInterface.jsx` is the `Enter` modal. `order = ['new', ...session ids]`; `active` clamps to a
real tab. On the New tab a `@${focusId}` prefix is prefilled (keyed on `focusId`, not the focus object,
so 4s board polling can't wipe typing) and `submit` POSTs `/api/sessions` then switches to the returned
id via `onCreated`. An existing tab renders `SessionTerm` (or the offline relaunch panel when status is
`offline`) with a docked `❯` textarea whose Enter calls `sendMsg` → `POST /api/sessions/:id/keys`.
Header buttons map to status: relaunch/review/merge/back-to-working(`resume`)/close, each a thin POST via
`act` then a board reload. A window-level capture listener owns `↑`/`↓` (list move) and Enter-on-New
(launch). `SessionTerm.jsx` opens a fixed 120×32 xterm, subscribes to `/api/sessions/:id/stream` (SSE),
and full-repaints (`\x1b[H\x1b[2J` + snapshot) on each distinct frame. `SessionWindow.jsx` is the
top-right floater: status-dot rows with an `opSummary` glyph count, `onPick` highlights overlays,
`onOpen` opens the interface.

### verdict — not drifted

After this rewrite the three governed files sit at this node's latest version with no commits ahead
(`spex lint` reports no `drift` warning for `session-console`; `SessionInterface.jsx` and
`SessionWindow.jsx` had each drifted by one commit, now reconciled). The expanded spec states the
interface's intended behavior; the description is the honest read of how the three components meet it.
Both faces render only what `/api/board` reports — no session logic lives in the dashboard — so the raw
source (a thin view over the backend's session state, identical to `spex board`) still holds.
