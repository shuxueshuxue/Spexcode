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

`Enter` on the board opens the session interface; the always-on top-left window (SessionWindow) is the
at-a-glance summary. Both are **thin views of `/api/board`** (i.e. `spex board`): the dashboard renders only
what the backend reports and never invents session state, so a human watching the dashboard and an agent
driving the same sessions through the CLI see identical state.

## expanded spec

The interface is a **near-fullscreen popup modal** over the dimmed board. Two panes: a left session list and a
right area that **morphs** by what's focused. The
list's **top button row** pairs `＋` New Session and the relationship-graph icon above the session rows (so
neither blocks the `↑/↓` path); New ⇄ graph is horizontal — `→` from an *empty* New enters, `←` returns.

**New Session** is a centred avatar + auto-growing input. Nothing is prefilled; the focused node is the first
**@-mention** suggestion, so the human opts in with `@`. A leading **`/`** opens the config-preset palette;
the two compose the launch grammar `/<preset> @<node>… <free text>`, from which the server derives the node (the
first `@<id>`). Both menus only insert text; the New prompt has **no** `/` slash-command menu (presets only). A preset launched with **no `@`-target** never assumes a node — the agent takes scope from the prompt, else asks first.

**View Session Relationship** fills the pane with the live monitor graph ([[session-graph]]) — its home now,
not a `t` overlay; the board's `t`/network button open onto it, and clicking a node switches to that session's tab.

An existing session shows its **live tmux terminal** (SessionTerm) with the docked **`❯` input** below — a
**real tmux client but a read-only scrollable view**. Read-only governs input, not extraction: text selects, the
wheel scrolls real history, a drag selects even under mouse-reporting, and `⌘/Ctrl+C` copies to the clipboard
**over HTTPS, localhost, or plain HTTP** (past the secure-context-only Clipboard API).

Input has **two channels**. The **`❯` box** is the prompt channel: submitting dispatches through the **control
socket** (never typed into the pane), so it lands even in copy-mode. The one exception is **`/exit` alone**:
the box intercepts it client-side and **closes this session directly** (`act('close')` — the same worktree
removal the row's right-click → Close performs) but with **no confirm**, since typing the exact command is
itself the deliberate act, where the row-menu's confirm guards an easy-to-mis-aim right-click. It is never
dispatched to the agent, which would only quit the agent's own process and orphan the worktree. It **holds
focus persistently** — clicking
chrome never blurs it, the panel **suppresses the native context menu** and **restores** focus after a
right-click. It **auto-grows upward**, **capped at half** the terminal height, with New's `/` **completion**
([[term-input]]). The second channel is **nav mode**: the `❯` box disables and keystrokes forward
**raw** to the pane (to drive the agent's TUI); the trigger is **manual** (header / `⌃/⌘+I`), and leaving the
tab or going offline exits.

A **right-click on a session row** opens its context menu — rename or close ([[session-rename]]) — coexisting
with the context-menu suppression; the shared `sessionName` puts that rename first in the label precedence.
Either input also accepts an **attached file** (paste, drop, or the 📎 picker), uploaded to the backend
(= worker) `/tmp` with its path spliced in — see [[file-attach]].

Terminals are **warm and always connected**: every live pane mounts and opens its socket when the board loads —
never lazily on focus — and stays mounted even while the console is closed, so switching tabs **never loses your
place** (socket + scroll survive), New Session included (it hides its pane). Warmth is **state, not GPU**: only
the **visible** pane holds a WebGL context, so many panes can't exhaust the browser's capped GPU contexts. List
navigation lives at the **window level** (arrows walk the list whatever holds focus). Header lifecycle
(relaunch / merge) follows state; offline shows a relaunch panel; review is **agent-proposed** at the
stop-gate. There is **no header close button** (its "close" misread as "close the panel" while it killed the
session + worktree): closing lives only on the row's right-click menu, behind a confirm ([[session-rename]]).
**Closing is event-driven**: the tab's *removal* — not any one gesture — drives where you
land. Still on the closed tab → New Session; already moved to another valid tab → your switch stands. The same
fallback covers a session that ends or is closed elsewhere, so the selection never points at a session the
board no longer has.

**SessionWindow** is the read-only glance, built from the shared **`SessionRow`** face — avatar (no status
dot) · name · the **colour-coded status word** (or 🔒 when locked) · pending-op count · activity. It stays a
**bounded** glance: the window never grows into a curtain — its height is capped (~80% of the viewport, and
always stopping short of the bottom **stats strip**), and a long session list **scrolls** inside it rather
than extending down over the board's stats bar. A single click **locks** the board onto
that session (overlays light, rest grey, focus jumps to its first changed node, see [[keyboard-nav]]); a
no-overlay session still locks un-greyed; a second click releases; **double-click opens** its board (mouse-side `⏎`). The **interface's own tabs** render the same `SessionRow` with those gestures **inverted**:
single click switches tab, double-click locks.

All surfaces share name and status from `session.js`, whose single **`STATUS_COLOR`** map paints **both** the
liveness dot **and** the status word the SAME hue everywhere they appear (window row, console tab + header,
@-mention and search rows, the relationship graph, the mobile card). Deliberately just **four hues — a traffic
light plus grey**: green = on track, no action from you (`working`, or `parked` — paused to self-resume), yellow
= waiting on YOU (`asking`/`review`/`done`), red = `error`, grey = stopped/dormant
(`idle`/`starting`/`queued`/`close-pending`/`offline`). The colour
only answers *does this session need me?* so a glance sorts the board without a legend; the word still spells the
exact state. Green for `working` also matches the avatar's liveness ring, so dot, word, and ring never disagree.
