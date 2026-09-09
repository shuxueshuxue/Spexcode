---
title: paged-palette
status: active
hue: 205
desc: The dashboard search palette is a two-plane jump-list over nodes and sessions — it ranks both from the board it was already handed and makes no review request of its own.
code:
  - spec-dashboard/src/SpecSearch.jsx
related:
  - spec-dashboard/src/corpus.js
  - spec-dashboard/src/address.js
---

# paged-palette

**The palette carries the two planes a workspace HOLDS: spec nodes and live sessions.** Both are things a tab
can be, so every row is somewhere the reader can go and stay — which is what makes this a jump-list rather
than a report. Node prose comes from the lite corpus, session identity from the live board; both are already
in the props the shell hands down, so opening the palette costs no request at all.

Issues are deliberately not a plane. An issue is a finding ABOUT a node, and it already has a list page built
to filter, page and sort it ([[issues-view]]) — one ⌥digit away, strictly better at the job than fifteen
interleaved rows and a total. A page-1 slice of it under the jump-list would be a worse copy of a surface that
already exists, and would pay a server round-trip per keystroke to do it; so the palette makes no review
request and carries no "all results" anchor.

**One ranking rule now, because both planes are local.** Each plane is ranked on its own by the shared
lexical ranker and the two are then interleaved — a node, a session, a node, a session. Not one ranking over
both: nodes carry far richer text than sparse sessions, so a single relevance list buries the session plane
(a node-heavy query like "session" returned only nodes). The preserve-the-server's-order branch is gone with
the planes that needed it; nothing here is a match-only page any more.

**`boost` is the only knob a caller turns**, and it names which plane leads. Matcher, interleave, keys and
rows are identical either way. The two callers are the dock's two projection heads ([[dock-modes]]): the
sessions head leads with sessions, the explorer head leads with nodes. The keyboard twin follows the same
rule — `/` leads with whatever projection is in force, and the `⌥/` chord leads with sessions because a
typing context is the one place the bare key cannot fire and a session console is what a typing context is.

An empty query is the plain jump-list: planes group in the caller's order and each keeps its source
surface's stable order. Picking routes through [[address-routing]] — a node opens its `#/spec/<id>` document,
a session jumps to its tab ([[session-console]]). A pick can also HOLD: ctrl/⌘-click on a row, or ctrl/⌘+Enter
on the keyboard selection — the pointer hold's twin for the hand that arrived by typing — hands the address to
the shell with the hold mark, and [[tab-strip]] decides what holding means. Plane boost, keyboard ownership and
selection routing remain [[session-search]]'s single shared behavior.
