---
title: side-nav
status: active
hue: 210
desc: The modern-app skeleton — one route-lit icon rail plus a dedicated dock open/close switch.
code:
  - spec-dashboard/src/SideBar.jsx#SideBar
  - spec-dashboard/src/SideBar.jsx#ENTRIES
related:
  - spec-dashboard/src/route.js
  - spec-dashboard/src/route.test.mjs
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/Dock.jsx
---

# side-nav

## raw source

The rail is the activity bar for routed destinations. Its light has exactly one meaning: the current route.
The dock projection is a separate, secondary fact shown by the dock header, never by the route light.

## expanded spec

- **One light, one route.** The compact 40px rail contains anchors for `graph`, `sessions`, `evals`, `issues`,
  and `settings`. A route anchor carries its canonical hash and uses `aria-current="page"` for the current
  route; at most one anchor is lit. `graph` and graph-node addresses light graph. `spec` and `file` are
  documents opened from explorer and deliberately light nothing; `empty` also has no light. Detail routes
  (`evals/<node>/<scenario>`, `issues/<id>`) light their page anchor. The rail never lights for dock mode.
- **Click is navigation plus projection selection.** A plain click remains an ordinary same-document route
  navigation (modified clicks keep browser behavior). The sessions anchor also opens the dock on the sessions
  projection; the graph anchor opens it on explorer. The selection is idempotent: clicking the current
  sessions anchor again navigates only and never folds the dock. Document routes select their related
  projection through the shell's derivation. Bare evals/issues/settings boards render full width; their
  object details retain the dock.
- **Dock folding has one owner.** The rail's top control is a dedicated, permanently mounted mirrored panel
  button: `panel-left` while open and `panel-right` while closed, with `aria-pressed` reporting the same
  boolean. It changes only dock open/closed state, never the route, projection, tab list, or route light. The
  dock header has no collapse control. Folding removes only the dock panel; the same rail DOM control remains
  at the same position and reopens it immediately.
- **Projection styling is secondary.** Explorer and sessions are projections, not rail destinations. Their
  names and tallies live in the dock header; neither projection may reuse `.rail-btn.on` or `aria-current`.
  If a route selection changes a projection, that state must remain visually distinct from the route light.
- **Pointer and keyboard behavior.** Rail links are real anchors with translated labels/tooltips and current
  keymap hints. Pointer presses are inert chrome for focus acquisition, while Tab and native Enter/Space
  activation remain available. The rail never scrolls or overlays page content.
- **Route peers.** The URL is hash state (`#/graph`, `#/sessions`, `#/evals`, `#/issues`, `#/settings`, plus
  document/detail tails). Page switches push history; list-to-detail and filter changes push; automatic route
  echoes replace. Bare evals/issues/settings boards are navigation destinations, not documents, so ordinary
  anchor navigation never creates or focuses a strip tab. Legacy review addresses normalize at the route layer.
- **Public graph.** The sealed graph-only face keeps the graph anchor and renders the other rail destinations
  muted and inert (`aria-disabled` with no href or handler); it mounts no live dock or transport.
