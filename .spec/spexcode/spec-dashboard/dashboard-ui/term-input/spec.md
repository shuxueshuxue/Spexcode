---
title: term-input
status: active
session: sess-cmdline
hue: 290
desc: The command line lives outside xterm, so the arrow keys are ours.
code:
  - spec-dashboard/src/TermPane.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
---
# term-input

## raw source

A terminal is for *driving* a session, but xterm swallows every keystroke — including the arrows we
navigate the tree with. So the command line must live **outside** xterm: the terminal is a read-only
display, and a separate input owns the keys. Because the input is ours, an arrow can mean "navigate" when
the line is empty and "edit" when it isn't — empty is the signal.

## expanded spec

`TermPane` makes xterm a read-only display (`disableStdin`, capture-pane output) with our own `.term-input`
line below it that mimics the prompt and echoes commands into the display on Enter. The arrow fall-through
is the point: when the line is **empty**, `←`/`→` walk parent/child and `↑`/`↓` walk the column (the same
`onNav` the graph uses, see [[keyboard-nav]]), so you toggle between nodes without leaving the pane; with
text present the arrows edit the line and stop bubbling so nothing double-fires. The principle is
transport-agnostic — wherever a live terminal sits beside spec navigation, the input stays outside xterm.

`TermPane.jsx` still implements that pattern verbatim — read-only xterm + external `.term-input`, the
empty-line `NAV` map calling `onNav` — and its CSS (`.pane-term` / `.term-host` / `.term-input` /
`.term-line`) still lives in `styles.css`, but it is **no longer mounted**: the work pane that hosted it was
removed from `NodeView.jsx`, whose popup is now a reference-only view (tabs `spec` / `recent` / `history`,
no terminal, no keyboard special-case — see [[work-pane]]). The live-terminal-with-external-input idea was
re-realised in the session interface ([[session-console]]): `SessionTerm` streams the real tmux pane
(read-only xterm over SSE) and a docked input forwards keystrokes via `/api/sessions/:id/keys`, with list
nav lifted to the **window** level so arrows survive xterm focus — the same "keys are ours, not xterm's"
guarantee, now over a real pane instead of a mock. `App.jsx`'s capture-phase listener still enforces that
arrows belong to navigation while a modal owns the keys. So `TermPane.jsx` stands as the original in-popup
realisation, presently dormant, while the contract lives on over a real session pane — the realisation moved
surfaces, the principle (input outside xterm so arrows can navigate) did not.
