---
title: plugins-page
status: active
hue: 40
desc: The rail's automation board — every plugin read by the surface it plugs into, the hooks drawn on the lifecycle they fire on, and how many worktrees actually carry them.
code:
  - spec-dashboard/src/PluginsView.jsx
related:
  - spec-dashboard/src/views.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/styles.css
  - spec-cli/src/plugins-view.ts
---

# plugins-page

A fifth rail board, beside Spec, Sessions, Issues and Settings, for the automation the project runs on
itself. It reads [[plugins-view]] and draws nothing it did not receive.

## it exists to change the READING, not to add the nodes

Every plugin here is already a spec node and already visible in the graph with its own hue. So this board
is not "make them visible" — that was already true — it is to read them by WHAT THEY DO rather than by
what they are. Two things a spec tree structurally cannot say are the whole reason for the board: a node
that plugs into two surfaces at once can appear only once in a tree, and a hook's event, its order inside
that event, and whether it may refuse have nowhere in a tree to live.

## the spine is the hook surface and only the hook surface

The events run down the page in the order an agent meets them over one session, and each hook sits on the
event it fires on, in its order, marked when it may refuse. That is drawable because it is a pipeline; an
event carrying two hooks is where the order stops being decoration, and an event carrying none says so in
words. The other surfaces have no timeline and are not forced onto it — always-on prose and invocable
verbs get a strip each, under the spine, which is also the honest shape: they are not lined up in time.

## the health line counts sessions, not directories, and is silent when there are none

The board opens with one bar: of the worktrees hosting a session right now, how many run the declared hook
contract, how many run something else, and how many run nothing at all. Each differing binding is then
named with the number of trees carrying it.

The denominator is the point. Counted over every registered worktree the line is a census of dormant
directories — a stale manifest in a worktree nobody will open again costs nobody anything, and a number
built mostly of those invites action where none is warranted. Counted over the sessions, it says something
a person can act on: an agent working right now under a hook the contract does not declare, or under no
Stop gate at all. With no live session the section is not rendered, because a bar of zeros is a claim too.
The numbers are the key to the bar; there is no second legend to read.

## one document, no dock

The board names no object, projects no navigator, and holds one full-width document. It is `resident`, so
the bare address is its one tab identity, and it is absent from the published-tree page set because a
static publication has no worktrees to report on.

## colour is spent against the surface, never between two inks

Every state on the board — matching, differing, absent, blocking — is a palette token. A colour mixed
between two ink tokens flips direction between light and dark palettes and can collapse to invisible on
one of them; the live seam's sweep lost a whole theme that way ([[conversation]]).
