---
title: focus-return
status: active
hue: 320
desc: A transient overlay returns the focus it took — never leaves it on <body>.
code:
  - spec-dashboard/src/focus.js#returnFocus
  - spec-dashboard/src/focus.js#inertChromePress
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/Modal.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/TimelineChat.jsx
---
# focus-return

The twin of [[keyboard-nav]]'s **a modal owns the keys**: **a modal returns the focus.** Like a notes app, the board always keeps focus on *some* input region — closing a search box or popup can never drop you onto an unfocused void.

## the gap this closes

Focus was managed by **acquisition without return**: every input and every overlay grabs focus when it mounts,
but giving it back was nobody's job. The transient overlays above a surface could close onto `<body>`, leaving
the next stray render to decide where keyboard input landed.

## the boundary

One decoupled mechanism, so an overlay need not know where focus belongs and the destination need not know the overlays exist:

- **The return ticket.** A single listener remembers the last element focused **outside** any overlay. An overlay marks its root so focus landing inside it is never recorded as the ticket — a modal's own input is transient, never a return target.
- **Return on close.** When the **last** transient overlay closes, focus goes back to the ticket if it is still
  on-screen and focusable, **else to the first currently focusable declared sink** — never merely the first
  sink in DOM order. The session page exposes exactly one current sink: New's textarea, Command Box's textarea
  while open, the active xterm helper textarea, or the active terminal-free conversation's composer. Warm
  hidden layers remove the marker. Never `<body>`. The return is deferred one frame and reads the ticket live; if a successor
  overlay already holds focus by then, it owns it — the return never yanks. The shared modal chrome returns
  on its own unmount, so every closing path — Esc, backdrop, cancel, submit — honors the contract without
  each caller wiring it.
- **Inert chrome.** The acquisition-side twin protects explicit chrome only: buttons, rows, resizers and menus
  can keep the current sink from being blurred while their click still acts. A read-only reading surface marks
  itself `data-reading-surface`; its pointer, browser Selection, copy and contextmenu remain native, and any
  authored action (such as a diff comment) belongs on a separate action door. The controller behind those surfaces
  publishes the native Range without painting a second selection or moving focus. A session tree drag remains an
  ordinary whole-row gesture; it is chrome, not reading text, so it may use the inert guard.

The **sink** is the notes-app axiom for authored inputs, not a reason to own reader focus. A surface names where
focus returns when an overlay closes; a reader may focus a native reading surface or leave focus in a composer,
and its draft/caret remains application state either way. The **session interface is a surface, not a transient
overlay** — it owns its chrome focus discipline, while [[selection-controller]] owns the reading selection seam.

## why decoupled, not a focus stack

A global push/pop focus stack would buy nesting this board never has — every transient overlay is mutually exclusive and sits exactly one layer above a surface. The ticket-plus-sink boundary spends no shared singleton or lifecycle: the only state is one remembered element, and the only contract two DOM markers (an overlay root, the sink input). Add an overlay → mark its root and it inherits the guarantee.
