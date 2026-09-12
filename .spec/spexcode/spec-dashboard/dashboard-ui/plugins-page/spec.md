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

## every row says what it is for, and opens

A name and a number is a fact nobody asked for. The question a person brings to this board is what a thing
does and why it is allowed to refuse, and both answers are already written: a node's `desc` is its one line
and its body is the rest. So each plugin is a card carrying that line, and the card IS the link to the node —
the ordinary `#/spec/<id>` address, read by the same reader the rest of the dashboard uses. Nothing here
restates a body or keeps a second description of anything.

The seven hooks had no `desc` at all when this board first drew them, which is how it shipped as a grid of
names and numbers explaining nothing. They have one now, because a plugin that cannot say what it is for in
one line is a plugin nobody can review.

## the profile is the switch, and it is read here, never written

Every core hook's body opens by saying the startup `SPEX_PROFILE` list may disable it with a clean no-op, so
that list is this surface's configuration and a board that omits it shows seven things that may or may not be
running. It is shown as the state it is — which profile is active, how many hooks it keeps, which it turns
off, with a disabled hook greyed in place rather than hidden. The board does not write it: the profile is an
environment variable of the process an agent launches under, not a project setting this page owns.

## the board says what the automation IS, never how a branch is doing
## one document, no dock

The board names no object, projects no navigator, and holds one full-width document. It is `resident`, so
the bare address is its one tab identity, and it is absent from the published-tree page set because a static
publication has no live plugin surface to read. Its body sits in the shared [[page-scroll]] scrollport like
every other document of this shape — it shipped without one, and a board taller than the viewport that
cannot be scrolled shows only its first screen.

## colour is spent against the surface, never between two inks

Every state on the board — matching, differing, absent, blocking — is a palette token. A colour mixed
between two ink tokens flips direction between light and dark palettes and can collapse to invisible on
one of them; the live seam's sweep lost a whole theme that way ([[conversation]]).
