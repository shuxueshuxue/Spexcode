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

The interface is a **near-fullscreen popup modal** over the dimmed board. Two panes: a left session list (its
header self-identifies the project, `// <project> sessions`) and a right area that **morphs** by what's focused.

**New Session** is a centred avatar + auto-growing input. Nothing is prefilled; the focused node is the first
**@-mention** suggestion, so the human opts in by typing `@`. A leading **`/`** opens the config-preset palette;
the two compose the launch grammar `/<preset> @<node>… <free text>`, from which the server derives the node
(first `@<id>`). Both menus only insert text; the New prompt has **no** `/` slash-command menu (reserved for our
presets). A preset launched with **no `@`-target** never assumes a node — the agent takes scope from the prompt,
else asks before acting.

An existing session shows its **live tmux terminal** (SessionTerm) with the docked **`❯` input** below — a
**real tmux client but a read-only scrollable view**. Read-only governs input, not extraction: text selects, the
wheel scrolls real history, a drag selects even under mouse-reporting, and `⌘/Ctrl+C` copies to the clipboard
**over HTTPS, localhost, or plain HTTP** (past the secure-context-only Clipboard API).

Input has **two channels**. The **`❯` box** is the prompt channel: submitting dispatches through the **control
socket** (never typed into the pane), so it lands even in copy-mode. It **holds focus persistently** — clicking
chrome never blurs it, the panel **suppresses the native context menu** and **restores** focus after a
right-click. It **auto-grows upward**, **capped at half** the terminal height, with the same `/` **slash-command
completion** as New ([[term-input]]). The second channel is **nav mode**: the `❯` box disables and keystrokes
forward **raw** to the pane (to drive the agent's TUI); trigger is **manual** (header / `⌃/⌘+I`), and leaving the
tab or going offline exits.

A **right-click on a session row** opens the rename pop-over ([[session-rename]]), coexisting with the
context-menu suppression; the shared `sessionName` puts that rename first in the label precedence. Either input
also accepts an **attached file**: paste, drop, or the 📎 picker uploads it to the backend (= worker) machine's
`/tmp` and splices the path in, so the agent gets a readable local path, not bytes (fail-loud on bad upload).

Terminals are **warm and always connected**: every live pane mounts and opens its socket when the board loads —
never lazily on focus — and stays mounted even while the console is closed, so switching tabs **never loses your
place** (socket + scroll survive), New Session included (it hides its pane, never unmounts). Warmth is **state,
not GPU**: only the **visible** pane holds a WebGL context, so many panes can't exhaust the browser's capped GPU
contexts. List navigation lives at the **window level** (arrows walk the list whatever holds focus). Header
lifecycle (relaunch / merge / close) follows state; an offline session shows a relaunch panel; review is
**agent-proposed** at the stop-gate, not a manual request. The header shows the **originating prompt** in a line.

**SessionWindow** is the read-only glance, built from the shared **`SessionRow`** face: avatar · name · status
(or 🔒 when locked) · pending-op count · activity. A single click **locks** the board onto that session
(overlays light, the rest grey, focus jumps to its first changed node, see [[keyboard-nav]]); a no-overlay
session still locks un-greyed; a second click releases; **double-click opens** its board (the mouse parallel to
`⏎`). The **interface's own tabs** render the same `SessionRow` with those gestures **inverted**: single click
switches tab, double-click locks. All surfaces share name and status from `session.js`.
