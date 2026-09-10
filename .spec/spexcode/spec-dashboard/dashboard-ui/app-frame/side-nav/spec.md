---
title: side-nav
status: active
hue: 210
desc: The modern-app skeleton — one route-lit icon rail, plus the dock fold switch that moves with the fold.
code:
  - spec-dashboard/src/SideBar.jsx#SideBar
  - spec-dashboard/src/SideBar.jsx#ENTRIES
related:
  - spec-dashboard/src/route.js
  - spec-dashboard/src/route.test.mjs
  - spec-dashboard/src/subtractive-boundaries.test.mjs
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/DockToggle.jsx
  - spec-dashboard/src/SessionForestPanel.jsx
  - spec-dashboard/src/TabStrip.jsx
---

# side-nav

## Anti-regression boundary

The live top-level rail is governed by `RAIL_PAGES` and contains every resident board in this order: `spec`,
`sessions`, `issues`, and `settings`; the addressable graph is deliberately excluded. `subtractive-boundaries.test.mjs`
checks this contract directly so a later lane cannot silently restore the graph as a live rail destination or
drop a resident board from top-level navigation.

## raw source

The rail is the activity bar for routed destinations. Its light has exactly one meaning: the current route.
The dock projection is a separate, secondary fact shown by the dock header, never by the route light.
The sessions entry may add a needs-you count badge as an overlay; the badge is attention state and never changes
the route light's meaning. The same count prefixes the browser title when non-zero. Project identity and
switching live in [[status-bar]]; the rail carries no project chip or duplicate switcher.

## expanded spec

- **One light, one route.** The compact 40px rail contains anchors for `spec`, `sessions`, `issues`,
  and `settings`. A route anchor carries its canonical hash and uses `aria-current="page"` for the current
  route; at most one anchor is lit. Graph addresses remain directly addressable but do not light a rail
  entry. Spec node and governed-file addresses project their light onto the resident Spec anchor, so the
  top-level destination remains selected while the reader is inside the Spec workspace. `empty` also has no
  light. Detail routes (`issues/<id>`) light their page anchor. The rail never
  lights for dock mode.
- **Click is navigation plus band opening.** A plain click remains an ordinary same-document route
  navigation (modified clicks keep browser behavior). The sessions anchor also opens the shared left band
  and focuses the most recently held session document when one exists; with no held session it lands on the
  bare sessions launch face. It pre-selects NO dock projection: its destination mounts no finding dock
  ([[dock-modes]]), so a projection written at click time could only flip the DEPARTING document's dock to a
  sessions projection for the frames before the route landed — a second, differently-styled sessions sidebar
  flashing between the explorer and the forest. The spec and graph anchors still select the explorer
  projection their destination derives. The selection is idempotent: clicking the current
  sessions anchor again navigates only and never folds the dock. Document routes select their related
  projection through the shell's derivation. Review and settings boards keep the rail — the top-level board
  switch is present on every desktop route — and mount no workspace dock, so their content takes the whole
  remaining width; review detail addresses remain on that surface and never acquire the dock. Because review addresses are not
  tabs, the rail remembers the last issues address and returns to it when the matching rail entry is
  pressed after leaving the surface.
- **Dock folding has one owner, and the switch moves with the fold.** One control (`DockToggle`) owns the
  open/closed boolean and stands where the fold is: while the sidebar is OPEN it is the last door of that
  sidebar's own head row — the explorer head's far corner, dressed as a head door; the Sessions forest's
  top row's far corner, dressed as a pill — the place an editor keeps the control that closes the panel you
  are looking at. While the sidebar is CLOSED there is no head row, so the switch is the tab strip's first
  cell ([[tab-layout]]): the rail's width wide and the band tall, an 18px glyph under a 28px hover pill,
  standing at the panel's edge where the panel would reappear. The rail itself carries no switch. It draws
  `panel-left` in BOTH states — it names the dock it owns, exactly as the document's right-dock switch
  always draws `panel-right` — with `aria-pressed` reporting open/closed; a glyph that flipped to
  `panel-right` to say "closed" drew a panel on the wrong side, and the owned pane is drawn solid so the
  glyph reads at 15px. It changes only dock open/closed state, never the route, projection, tab list, or
  route light, and has no light of its own. Folding removes the dock panel and its head row, and the same
  control reappears at the strip's edge in the same instant, so the reader's pointer has one short move
  to reopen it.
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
- **Route peers.** The URL is hash state (`#/sessions`, `#/spec`, `#/issues`, `#/settings`, plus
  document/detail tails). Page switches push history; list-to-detail and filter changes push; automatic route
  echoes replace. Bare issues/settings boards are navigation destinations, not documents, so ordinary
  anchor navigation never creates or focuses a strip tab. Their resident workspace tabs are the exception:
  when already held, a board/detail route focuses the same page tab and keeps the page icon declared by
  [[view-registry]]. Legacy review addresses normalize at the route layer.
- **Published tree.** A published spec tree ([[public-spec-graph]]) runs this same rail, not a sealed one of
  its own — the SAME entries in the same order, with no marker the live rail does not have. The graph is
  excluded there for the reason it is excluded here: it is addressable, not a top-level board. What differs
  is only which entries answer: those in `PUBLIC_PAGES` are live, and every destination outside that set is
  muted and inert (`aria-disabled` with no href or handler). The enabled set is read from that one exported
  list rather than spelled out here again. No live dock or transport mounts either way.
