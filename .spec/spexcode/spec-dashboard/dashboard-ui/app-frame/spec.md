---
title: app-frame
status: active
hue: 200
desc: What is already true before any destination page mounts — the root that boots and themes, the rail and URL vocabulary that swaps pages, the face the viewport picks, the one document scrollport, and the pathname that scopes it all to a project.
---
# app-frame

A destination — the graph, the session console, the review surfaces, settings — renders **inside** a frame
it does not own. This node is that frame. Its children answer one question together, *what is already true
when a page mounts*: what booted, what data it is reading, what palette it is drawn in, how its address
became a page, which face the viewport chose, what scrollport it was handed, and which project the
pathname scoped it to. Read apart, each contract has a hole where another's half sits — the shell defines
the page pane's viewport and [[page-scroll]] owns that viewport's overflow; the shell picks a face by width
and [[mobile-ui]] is the face it picks; the shell calls project scope its own concern and [[projects-hub]]
is where that seam lives.

- [[dashboard-shell]] — the root: the entry, the one polled board layer, the global stylesheet and palette,
  the single writer of the tab head, the lazy-chunk split and its one reload recovery.
- [[side-nav]] — the rail and the route layer: one entry per page, one URL per page, push for a human's
  navigation and replace for automatic state-naming, and the global ⌥ vocabulary.
- [[mobile-ui]] — the phone face the entry picks by viewport width, over the same board, routes, and API.
- [[page-scroll]] — the one full-page scrollport: track insets, stable gutter, sticky containment, and
  address-keyed restoration for every document-shaped page.
- [[projects-hub]] — the pathname scope: `/p/<id>/` prefixes every API call through one seam, and the
  global fleet face administers the catalog behind one credential card.

The boundary runs both ways. A **rail destination stays outside** this node — the frame carries no page's
content contract, which is why the graph, the console, the review surfaces, and settings remain its peers
rather than its children. And a page never re-implements a frame concern: no second full-page scrollbar,
no second route layer, no page-written `document.title` or favicon, no feature module that knows it is
project-scoped.

This node owns no source of its own — each child keeps its files, `[[links]]`, and drift.
