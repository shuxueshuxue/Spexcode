---
title: work-pane
status: active
session: sess-merge
hue: 335
desc: The node popup — a reference view of intent; the live work surface moved to the session interface.
code:
  - spec-dashboard/src/NodeView.jsx
---
# work-pane

## raw source

The spec and the terminal are one act split in two — the spec is the *intent*, the terminal is where you
*change it in place*. Originally they shared one pop-out `work` pane, two columns (spec left for reading,
terminal right for the work), so intent and the surface that changes it sat side by side in a fixed-size
panel that never grows to xterm's measured width.

## expanded spec

The node popup is the `i` surface: a fixed pop-out (`min(900px,90vw) × min(600px,84vh)`) with tabs, opened
over the board and dismissed with `Esc`. The intent half is the **spec doc** — title, desc, governed-code
list, and the body rendered as a living current-state document (two labelled parts — raw source / expanded
spec — when the body is authored that way; see [[three-part-body]]). The proof and evolution of that intent
live in the **history** tab. The "change it in place" half — a live
terminal — belongs with the *session* that does the changing, not pinned to one node. The panel must size to
itself, never to xterm: `min-width:0` runs down the flex chain and the body is `overflow:hidden`, each pane
scrolling its own content, so there is no stray horizontal scrollbar.

`NodeView.jsx` realises this as a **reference-only** popup: tabs are `spec` / `history` (`PANES`),
with no `work` pane and no embedded terminal. `SpecPane` renders the spec doc (`# title`, desc blockquote,
status/version/session meta, `// governs` code list) and dispatches the body to `TwoPart` when `node.parts`
is present, else the flat `SpecBody`. `HistoryPane` reads `/api/specs/:id/history` and is the single merged
version log: the latest version sits expanded with its proof, older ones start collapsed and reveal as the
reader scrolls down past the one they are reading (a header click toggles any by hand). A version's proof is
the **spec.md line diff** it introduced — the latest version's diff ships precomputed with the board, older
ones fetch lazily on expand; a version with no recorded change says so plainly. The "change
it in place" surface relocated to the session interface (`Enter`; see [[session-console]] and [[term-input]])
— that is where the live terminal now lives, keyed to a session rather than a node. The sizing contract is
expressed in CSS — the `.ov-panel` fixed pop-out, `.pane-solo` for the single-pane body, `min-width:0` down
the chain, `overflow:hidden` body — but `styles.css` is the dashboard's shared stylesheet and is governed by
[[node-graph]]; this node owns only `NodeView.jsx`, the popup component, so a style change elsewhere never
reads as drift here. So the original "one act split in two" intent stands, but the union is dissolved:
intent in the popup, the changing surface with the session.
