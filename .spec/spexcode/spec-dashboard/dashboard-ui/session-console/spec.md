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
dropdown of spec nodes (matched on id and spec path). A leading **`/`** opens the config-preset palette; the
two compose the launch grammar
`/<preset> @<node>… <free text>` into one prompt, from which the server derives the session's node (the first
`@<id>`). Both menus are pure assistance — picking a row only inserts text; the human still launches. The New
tab's prompt deliberately has **no** `/` slash-command menu (that surface is reserved for our own presets).

An existing session shows its **live tmux terminal** (SessionTerm) with the **single human input** docked at
the bottom. The terminal is a **real tmux client but a pure read-only scrollable view** — the human never
types into it. Read-only governs **input, not extraction**: a plain drag (no modifier) selects text, drawn in
a bright always-on highlight, and `⌘`/`Ctrl`+C copies that exact selection with a "copied" flash; the mouse
wheel scrolls tmux's real pane history. The pane is **dark** (the Claude Code TUI inside is built for a dark
terminal) and **scales to its panel**. A (re)joining viewer is painted by a **single coherent full repaint**,
never a snapshot spliced into the live stream — so tab-switching leaves no half-painted state.

Human input has **two channels for two jobs**. The docked **`❯` box** is the *prompt* channel: submitting
dispatches the line through the **control socket** — never by typing into the pane — so it lands even while
tmux is in copy-mode (which scrolling enters). It wears the same `/` **slash-command completion** as the New
tab ([[term-input]]), here listing CC's commands and opening **upward**. The second channel is **nav mode**:
while on, the `❯` box is disabled and every keystroke is forwarded **raw** to the pane, so the human can drive
the agent's interactive TUI menus (`/model`'s list, …). Its trigger is **manual and authoritative** — a header
toggle and a `⌃/⌘+I` chord enter/exit it (a second Esc also exits); a best-effort pane sniff only *suggests*
it by pulsing the button, never seizes keys. Exiting refocuses the `❯` box; leaving the tab or going offline
also exits, so keystrokes can never reach the wrong pane.

Switching tabs is **instant and never loses your place**: every opened terminal stays mounted (its socket and
scroll survive) and the backend keeps a warm tmux client per live session. List navigation lives at the
**window level**, so arrows walk the list regardless of what holds focus (xterm included). Header lifecycle
actions (relaunch / merge / back-to-working / close) follow the session's state; an offline session shows a
relaunch panel instead of a dead terminal. There is **no manual "request review"** — review is
**agent-proposed** at the stop-gate (`session done --propose merge`), so the header only surfaces actions a
human still drives.

**SessionWindow** is the read-only glance: every session as a status dot with a pending-op count. It carries
**two gestures that mirror the graph**: a single click **locks** the board onto that session (its overlays
light, every other node greys, focus jumps to its first changed node) and a second click releases — the locked
row wears the same grip (spine, tint, 🔒) so row and dimmed graph read as one selection. **Double-click opens
that session's board**, the mouse parallel to `⏎`. The window and the interface share their dot-colour and
display-name primitives from `session.js`, so a session reads the same on every surface.
