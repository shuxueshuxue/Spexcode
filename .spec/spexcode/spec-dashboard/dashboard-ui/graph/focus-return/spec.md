---
title: focus-return
status: active
hue: 320
desc: A transient overlay returns the focus it took — never leaves it on <body>.
code:
  - spec-dashboard/src/focus.js#returnFocus
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/Modal.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/SessionInterface.jsx
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
- **Inert chrome.** The acquisition-side twin: a pointer-down on chrome that is not itself an input surface
  (not an editable field, the xterm screen, a scrollbar gutter, or an explicitly marked native-selection
  region) is **prevented from moving focus at all** — the click still lands and acts. A native-selection
  region keeps the browser's default press so ordinary text can be drag-selected, double-clicked, and copied.
  When that gesture ends, the surface returns keyboard ownership to its exact local sink while restoring any
  non-collapsed document Selection: selection remains visible/copyable, yet the next printable key reaches the
  draft instead of `body`. It is interaction content, not dead chrome. A surface or menu attaches this one capture-phase guard, and
  then most pops need no return because focus never left: the ticket stays pinned to the real input region
  instead of getting polluted by the button that opened the pop.

The **sink** is the notes-app axiom made concrete: a surface names where focus rests when nothing else claims it. The **session interface is a surface, not a transient overlay** — it owns its own focus discipline and hosts the sink, so it stays outside this boundary; the boundary governs only the modals that float over it.

## why decoupled, not a focus stack

A global push/pop focus stack would buy nesting this board never has — every transient overlay is mutually exclusive and sits exactly one layer above a surface. The ticket-plus-sink boundary spends no shared singleton or lifecycle: the only state is one remembered element, and the only contract two DOM markers (an overlay root, the sink input). Add an overlay → mark its root and it inherits the guarantee.
