---
title: focus-return
status: active
hue: 320
desc: A transient overlay returns the focus it took — never leaves it on <body>.
code:
  - spec-dashboard/src/focus.js
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

Focus was managed by **acquisition without return**: every input and every overlay grabs focus when it mounts, but giving it back was nobody's job. Each *surface* privately keeps itself focused — the session interface's docked `❯` box re-grabs focus after a click or context menu — but the transient overlays that float **above** every surface (the search palette, the help and settings modals, the node popup) took focus on open and, on close, dropped it to `<body>`. Nothing pulled it back, so the next stray re-render's focus effect — or none — decided where it landed. Escaping search felt like focus was *stolen*; it was simply never *returned*.

## the boundary

One decoupled mechanism, so an overlay need not know where focus belongs and the destination need not know the overlays exist:

- **The return ticket.** A single listener remembers the last element focused **outside** any overlay. An overlay marks its root so focus landing inside it is never recorded as the ticket — a modal's own input is transient, never a return target.
- **Return on close.** When the **last** transient overlay closes, focus goes back to the ticket if it is still on-screen and focusable, **else to the declared sink** — the surface's always-focused input (the session board's docked box). Never `<body>`. The return is deferred one frame and reads the ticket live, so it **converges on** the latest stable focus rather than fighting a sibling that is also settling focus (e.g. opening the session interface from a search pick).

The **sink** is the notes-app axiom made concrete: a surface names where focus rests when nothing else claims it. The **session interface is a surface, not a transient overlay** — it owns its own focus discipline and hosts the sink, so it stays outside this boundary; the boundary governs only the modals that float over it.

## why decoupled, not a focus stack

A global push/pop focus stack would buy nesting this board never has — every transient overlay is mutually exclusive and sits exactly one layer above a surface. The ticket-plus-sink boundary spends no shared singleton or lifecycle: the only state is one remembered element, and the only contract two DOM markers (an overlay root, the sink input). Add an overlay → mark its root and it inherits the guarantee.
