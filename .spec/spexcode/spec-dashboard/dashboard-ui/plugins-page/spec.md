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

## the health of the install is stated before the inventory

The first thing on the board is not a list, it is one bar: of the project's worktrees, how many carry the
declared hook contract, how many carry something else, and how many carry nothing at all. Each differing
binding is then named with the number of trees carrying it. This is first because it is the half nobody
could see anywhere else — a tree that was materialized before a contract changed goes on running the old
set silently, and a tree with no manifest runs no hooks at all, Stop gate included. The numbers are the
key to the bar; there is no second legend to read.

## one document, no dock

The board names no object, projects no navigator, and holds one full-width document. It is `resident`, so
the bare address is its one tab identity, and it is absent from the published-tree page set because a
static publication has no worktrees to report on.

## colour is spent against the surface, never between two inks

Every state on the board — matching, differing, absent, blocking — is a palette token. A colour mixed
between two ink tokens flips direction between light and dark palettes and can collapse to invisible on
one of them; the live seam's sweep lost a whole theme that way ([[conversation]]).
