---
title: ui-state-model
status: active
hue: 200
desc: The workspace's frontend states enumerated as a product of five axes, with a band budget B(state) each one must hold — the machine-checkable form of "no stacking layer upon layer".
code:
  - spec-dashboard/test/band-budget.e2e.mjs
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/ContextDock.jsx
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/StatusBar.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/SpecView.jsx
  - spec-dashboard/src/FileView.jsx
  - spec-dashboard/src/SourceView.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/budgetContracts.test.mjs
---
# ui-state-model

**"不要层层叠叠" is a number, or it is nothing.** Left as taste, the instruction loses every argument
against the next well-argued row: each one is small, each one is justified by its own feature, and nobody
is counting. This node makes the instruction countable. The workspace's reachable states are enumerated
from their axes, each state carries a **band budget** derived from what the frame is actually for, and the
gate measures the running DOM against that budget. A row that stacks past the budget is not a matter of
opinion afterwards; it is a failing state with a name.

## the axes

A workspace state is a point in the product of five axes. [[workspace-shell]] owns the first four,
[[session-console]] the fifth.

- **R — route kind** ∈ {graph, evals, issues, settings, empty, spec, file, session}. What the address
  names; [[view-registry]] maps it to what renders. `graph` is a live rail destination and deep-link address.
  Bare review/settings boards are full-width, while object detail routes remain document states with a dock.
- **D — left dock** ∈ {closed, explorer, sessions}. Open/closed and the projection are one axis, because
  a dock with no projection is not a state ([[dock-modes]]).
- **C — right context** ∈ {closed, open}. Meaningful only when R = spec; forced closed everywhere else,
  because [[context-dock]] renders for a spec document and nothing else. `closed` is the RESTING value: the
  dock renders nothing at all when closed — no rail, no collapsed spine — so the axis's default costs the
  budget zero. That matters to the theorem's floor as much as to the reader: a "collapsed" dock that still
  drew a hairline spine would be a band by any honest classifier while claiming not to be one.
- **S — split** ∈ {none, open}. A second route beside the first ([[tab-strip]]).
- **U — session surface** ∈ {conversation, terminal, diff, resource}. Meaningful only when R = session.
  This is **the one surface axis** — a session's face is a value of U, never a second dock, a second
  strip, or a mode that adds its own frame ([[session-surface]]).

The constraint set is exactly those two "meaningful only" rules: C collapses to one value off a spec
document, U collapses to one value off a session. Nothing else is constrained, and the state count is
whatever the axes yield rather than a figure carried in prose — the gate enumerates and prints it, so the
cardinality is measured beside the budget instead of asserted above it.

## what a band is

A **band** is a non-scrolling chrome container between the window edge and the content — a row or a column
the reader cannot scroll away, which therefore costs its thickness on every state that shows it. Three
things are deliberately **not** bands, because each was a tempting way to smuggle one in:

- **Overlays are z-layers.** The palette, a node popup, a context menu float *over* the content and cost it
  nothing. They may stack freely; they are not in the budget.
- **Resize handles are not bands.** A grab strip between two panes is a seam, not a row ([[resizable-panes]]).
- **The preview slot is a tab property**, not a band. What a tab is previewing changes the content, not the
  frame around it.
- **A wrapped tab strip is one band, at any height.** The strip lays its working set out on as many rows as
  it needs rather than scrolling ([[tab-strip]]); the rows are the strip's internal layout, and a model that
  counted them would be counting the reader's open documents as chrome. This is the one place the model
  separates a band's COUNT from its thickness, and the separation is deliberate: the budget bounds how many
  things frame the content, never how tall any one of them is. Thickness here is the reader's own — it grows
  only when someone holds another document, and it shrinks when they close one.

A vertical scrollport is where the content begins: everything below it belongs to the document, so nothing
inside one is chrome, whatever its position ([[page-scroll]]). Membership is **declared, not measured** —
`overflow-y: auto` says "this is the document" whether or not today's data happens to be short enough to
fit. The alternative makes the band count depend on how much loaded, which is not a property of the frame.

Bands are counted **leaf-most within a region**. A wrapper whose only job is to hold a row collapses into
the row it holds — that is one band, which is what the model claims. But two sibling rows in one region are
**two**: a dock modebar above a dock header is 2, not 1. That is the whole point of counting. The model
says the dock is ONE band, so a mode row stacked above its header is a breach the gate must name.

## the budget

    B(state) = 1(rail) + dock + 1(tabstrip) + 1(statusbar) + context

    dock    = 1  iff  D ≠ closed  and  R is not a bare evals/issues/settings board
    context = 1  iff  R = spec    and  C = open

Rail, tab strip and status bar are unconditional: one persistent way to change destination
([[side-nav]]), one place the open documents are named ([[tab-strip]]), one line of ambient state
([[status-bar]]). The tab strip is unconditional in the strongest sense — it is the workspace itself and
it stays on every route, so the working set is always in reach ([[tab-strip]]). The dock and the context
dock are the only conditional bands, and the dock's condition has **two** factors because the sidebar is a
property of the focused tab and not a window-wide setting ([[dock-modes]]): the reader's own open/closed
choice, and whether the focused tab has a natural sidebar at all. Only bare evals, issues and settings boards
lack that sidebar; object details retain it. The rule is ISOLATION, not suppression: a bare board never
inherits the dock the previous tab was showing, which keeps the sidebar a fact about what is held.
Split adds a **column**, never a band. U picks what fills the content area, never how much chrome frames it.

**Theorem: 3 ≤ B ≤ 5 over every reachable state.** The floor is a closed dock on a non-spec route
(rail + strip + status); the ceiling is a spec document with both docks open. There is no state in which
the frame may cost six. A view that needs a control surface of its own must earn it inside the content
area, below the scrollport, or take the place of a band rather than stack on one.

## the gate

`spec-dashboard/test/band-budget.e2e.mjs` is the machine-checkable definition of the instruction. It walks
a representative traversal of the state space in a real browser against the running dashboard — every route
kind against every dock value, the context axis doubled on the one route that owns it, both guaranteeable
session surfaces, and a split state — classifies the bands the DOM actually renders, and fails any state
where measured ≠ predicted, ranked by excess and named by offending class.

**Every state is entered with a WORKING SET DEEP ENOUGH TO WRAP the strip,** and the row count is printed
beside the band count. Measuring the fattest strip rather than an empty one is the stronger gate — an empty
strip is the one shape in which a stowaway band has nowhere to hide — and it turns "one band however many
rows" from a claim into a measurement. The gate fails if the strip stops wrapping, because a property that
is no longer exercised is a property no longer checked, even while every state still passes. The classifier is seeded with
the shell's known chrome inventory so a band thicker than the geometric threshold is still caught by name,
and falls back to geometry — a non-growing, statically-positioned container that spans its region's long
axis and stays thin on the short one — so chrome the inventory has never heard of is caught anyway.

B() lives once, in the gate, mirroring this body. A state's budget is not stored per-route, because a
per-route budget is a per-route excuse: the frame is uniform or it is not a frame.

The executable source guard in `spec-dashboard/src/budgetContracts.test.mjs` keeps the theorem coupled to its
two cheap, non-browser invariants: `B` remains the sole 3..5 model in the real Chromium gate, and the keep-alive
pool's idle script budget remains `0.05s / 10s`. It is not a replacement for the browser readings; it prevents
the gate's budget and the product's declared pool contract from drifting silently when the shell is refactored.

## what the count bought

Every visited state holds its budget. Getting there was not one fix but four different admissions, and the
shape of each is the useful part — a band is almost never removed by deleting a feature:

- **Merged into the band that already existed.** The explorer's count row, the sessions `+` row and the
  archive door became the dock's single header ([[dock-modes]]); a file document's path became a
  [[status-bar]] item. A projection may name itself, and a document may state a fact about itself, without
  either being given a row.
- **Folded into scrolling content.** The spec document's file picker is now the prose's own governed-files
  chips ([[spec-view]]), which live below the scrollport and are therefore content by definition.
- **Deleted, because it was a repetition.** The source viewer's footer repeated a path the address, the tab
  and the chip already carried ([[source-view]]); what it uniquely said — whether the read had finished —
  became a floating mark that leaves when it stops being true.
- **Turned into a z-layer.** The Conversation's composer floats over its reading column exactly as Command
  Box does on the terminal surface ([[session-console]]), which is what makes U genuinely a content axis
  rather than a surface that quietly costs a row.

One more was a spacer rather than a band: the shell held the tab strip inside a wrapper that drew a blank
row on every route minting no tab. The strip is now the band itself and names the routed place when it
holds nothing ([[tab-strip]]) — the row was always being paid for, and now it says something.
