---
title: session-console
status: active
hue: 280
desc: The Enter surface — two-pane session interface with a live tmux terminal.
code:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/session.js
---

# session-console

## raw source

`Enter` on the board opens the session interface; the always-on top-right window (SessionWindow) is the
at-a-glance summary. Both are **thin views of `/api/board`** (i.e. `spex board`): the dashboard renders only
what the backend reports and never invents session state, so a human watching the dashboard and an agent
driving the same sessions through the CLI see identical state.

## expanded spec

The interface is two panes: a left session list and a right content area that **morphs** by what's focused.

**New Session** is a centred avatar + auto-growing input. Nothing is prefilled; the focused node is instead
the first **@-mention** suggestion, so the human opts into a target by typing `@` — a narrow, keyboard-first
dropdown of spec nodes. A leading **`/`** opens the config-preset palette; the
two compose the launch grammar
`/<preset> @<node>… <free text>` into one prompt, from which the server derives the session's node (the first
`@<id>`). Both menus are pure assistance — picking a row only inserts text; the human still launches. The New
tab's prompt deliberately has **no** `/` slash-command menu (that surface is reserved for our own presets).

An existing session shows its **live tmux terminal** (SessionTerm) with the **single human input** docked at
the bottom. The terminal is a **real tmux client but a pure read-only scrollable view** — the human never
types into it. Read-only governs **input, not extraction**: text still selects and copies, and the wheel
scrolls tmux's real pane history. Extraction is **terminal-like**: selecting and copying in the pane **never
steal keyboard focus** from the docked `❯` box, so a human grabs scrollback text mid-sentence and keeps
typing. The pane is **dark** (for the Claude Code TUI inside) and **scales to its panel**. A (re)joining
viewer gets a **single coherent full repaint**, never a snapshot spliced into the live stream — so
tab-switching never half-paints.

Human input has **two channels for two jobs**. The docked **`❯` box** is the *prompt* channel: submitting
dispatches the line through the **control socket** — never by typing into the pane — so it lands even while
tmux is in copy-mode. It wears the same `/` **slash-command completion** as the New
tab ([[term-input]]), here for CC's commands. The second channel is **nav mode**:
while on, the `❯` box is disabled and every keystroke is forwarded **raw** to the pane, so the human can drive
the agent's interactive TUI menus (`/model`'s list, …). Its trigger is **manual and authoritative** — a header
toggle (and `⌃/⌘+I`) enters/exits; a best-effort sniff only *suggests* it, never seizes keys. Exiting refocuses
the `❯` box; leaving the tab or going offline also exits, so keystrokes can never reach the wrong pane.

Terminals are **warm and always connected**: every live session's pane is mounted and its socket opened the
moment the board loads — never lazily on focus — and since the surface stays mounted whether or not the
console is open, the sockets stay live **even while it's closed**, so reopening reveals panes that were warm
all along. Switching tabs therefore **never loses your place** (socket and scroll survive), for **every** tab
including **New Session**, which only hides its pane, never unmounts it. Warmth is **state, not GPU**: only the
**visible** pane is GPU-accelerated, so opening many panes can't exhaust the browser's capped GPU contexts. The backend keeps a warm tmux client
per live session. List navigation lives at the
**window level**, so arrows walk the list regardless of what holds focus (xterm included). Header lifecycle
actions (relaunch / merge / close) follow the session's state; an offline session shows a
relaunch panel instead of a dead terminal. There is **no manual "request review"** — review is
**agent-proposed** at the stop-gate, so the header only surfaces actions a human still drives.

**SessionWindow** is the read-only glance: every session as a status dot with a pending-op count. It carries
**two gestures that mirror the graph**: a single click **locks** the board onto that session (its overlays
light, the rest grey, focus jumps to its first changed node) and a second click releases — the locked row
wears the same grip so row and dimmed graph read as one selection. **Double-click opens
that session's board**, the mouse parallel to `⏎`. The window and the interface share their dot-colour and
display-name from `session.js`, so a session reads the same on every surface.
