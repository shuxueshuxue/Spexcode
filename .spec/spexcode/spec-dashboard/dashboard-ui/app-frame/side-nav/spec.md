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
  - spec-dashboard/src/subtractive-boundaries.test.mjs
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/Dock.jsx
---

# side-nav

## Anti-regression boundary

The live top-level rail is governed by `RAIL_PAGES` and contains every resident board in this order: `spec`,
`sessions`, `evals`, `issues`, and `settings`; the addressable graph is deliberately excluded. `subtractive-boundaries.test.mjs`
checks this contract directly so a later lane cannot silently restore the graph as a live rail destination or
drop a resident board from top-level navigation.

## raw source

The rail is the activity bar for routed destinations. Its light has exactly one meaning: the current route.
The dock projection is a separate, secondary fact shown by the dock header, never by the route light.
The sessions entry may add a needs-you count badge as an overlay; the badge is attention state and never changes
the route light's meaning. The same count prefixes the browser title when non-zero. Project identity and
switching live in [[status-bar]]; the rail carries no project chip or duplicate switcher.

## expanded spec

- **One light, one route.** The compact 40px rail contains anchors for `spec`, `sessions`, `evals`, `issues`,
  and `settings`. A route anchor carries its canonical hash and uses `aria-current="page"` for the current
  route; at most one anchor is lit. Graph addresses remain directly addressable but do not light a rail
  entry. Spec node and governed-file addresses project their light onto the resident Spec anchor, so the
  top-level destination remains selected while the reader is inside the Spec workspace. `empty` also has no
  light. Detail routes (`evals/<node>/<scenario>`, `issues/<id>`) light their page anchor. The rail never
  lights for dock mode.
- **Click is navigation plus projection selection.** A plain click remains an ordinary same-document route
  navigation (modified clicks keep browser behavior). The sessions anchor also opens the dock on the sessions
  projection and focuses the most recently held session document when one exists; with no held session it
  lands on the bare sessions launch face. The selection is idempotent: clicking the current
  sessions anchor again navigates only and never folds the dock. Document routes select their related
  projection through the shell's derivation. Review and settings boards keep the rail — the top-level board
  switch is present on every desktop route — and mount no workspace dock, so their content takes the whole
  remaining width; review detail addresses remain on that surface and never acquire the dock. Because review addresses are not
  tabs, the rail remembers the last evals/issues address and returns to it when the matching rail entry is
  pressed after leaving the surface.
- **Dock folding has one owner.** The rail's top control is a dedicated, permanently mounted mirrored panel
  button: `panel-left` while open and `panel-right` while closed, with `aria-pressed` reporting the same
  boolean. It changes only dock open/closed state, never the route, projection, tab list, or route light. It
  is a smaller 14px muted control with a restrained separator and spacing from the navigation group, so it
  reads as frame chrome rather than an independent tab. The dock header has no collapse control. Folding
  removes only the dock panel; the same rail DOM control remains at the same position and reopens it immediately.
  The control is mounted wherever a sidebar exists to fold: the shell's dock, or the Sessions document's own
  forest ([[session-console]]), which follows the same open/closed boolean so Spec and Sessions fold from one
  control. Bare review and settings boards omit it because they have neither sidebar.
- **Projection styling is secondary.** Explorer and sessions are projections, not rail destinations. Their
  names and tallies live in the dock header; neither projection may reuse `.rail-btn.on` or `aria-current`.
  If a route selection changes a projection, that state must remain visually distinct from the route light.
- **Pointer and keyboard behavior.** Rail links are real anchors with translated labels/tooltips and current
  keymap hints. Pointer presses are inert chrome for focus acquisition, while Tab and native Enter/Space
  activation remain available. The rail never scrolls or overlays page content. It and the optional dock
  fill the app row and stop at the full-width status row; their one-pixel `--line` right seam meets that row
  as a clean T rather than continuing through its bottom edge.
- **Route controls only.** The permanently mounted controls are the dock toggle and the five route entries.
  The former top project chip is absent: its mark, visible name, catalog menu, offline rules, guest login
  door, and `/projects` management entry moved together to the status row, so project switching has one
  persistent owner rather than two entrances with different geometry.
- **Route peers.** The URL is hash state (`#/sessions`, `#/spec`, `#/evals`, `#/issues`, `#/settings`, plus
  document/detail tails). Page switches push history; list-to-detail and filter changes push; automatic route
  echoes replace. Bare evals/issues/settings boards are navigation destinations, not documents, so ordinary
  anchor navigation never creates or focuses a strip tab. Their resident workspace tabs are the exception:
  when already held, a board/detail route focuses the same page tab and keeps the page icon declared by
  [[view-registry]]. Legacy review addresses normalize at the route layer.
- **Public graph.** The sealed graph-only face keeps the graph anchor and renders the other rail destinations
  muted and inert (`aria-disabled` with no href or handler); it mounts no live dock or transport.
