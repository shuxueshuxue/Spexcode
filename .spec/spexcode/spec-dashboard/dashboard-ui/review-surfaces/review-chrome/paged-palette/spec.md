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

It used to carry two more planes — Issues and scenarios — fetched live from page 1 of `/api/issues` and
`/api/evals` on every debounced keystroke, plus a command row of **all Issues · N** / **all Evals · N**
anchors into the review lists. That was a search box quietly growing a second job. An issue and a scenario
are findings ABOUT a node, and they already have list pages built to filter, page and sort them
([[issues-view]] / [[evals-view]]) — each one ⌥digit away, each strictly better at the job than fifteen
interleaved rows and a total. Restating a page-1 slice under the jump-list gave the reader a worse copy of a
surface that already existed, and paid two server round-trips per keystroke to do it. Removing the planes
removes the round-trips, the "all results" anchors, and the second ranking rule with them.

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
a session jumps to its tab ([[session-console]]). Plane boost, keyboard ownership and selection routing remain
[[session-search]]'s single shared behavior.
