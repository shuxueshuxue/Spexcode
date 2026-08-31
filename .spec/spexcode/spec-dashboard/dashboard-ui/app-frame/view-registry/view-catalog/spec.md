---
title: view-catalog
status: active
hue: 225
desc: The registry's component-free face, so asking what a page kind IS never drags in what renders it.
code:
  - spec-dashboard/src/viewCatalog.js
related:
  - spec-dashboard/src/views.jsx
  - spec-dashboard/src/tabs.js
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/SideBar.jsx
---
# view-catalog

[[view-registry]] answers two different kinds of question, and only one of them needs a component.

**What renders this address** is a component lookup: the shell asks `viewFor(page)` and mounts what comes
back. **What kind of thing is this address** is not: whether a page is a document, whether it is resident,
which glyph it wears. The tab strip and the activity rail ask only the second kind, and they must be able to
ask it without importing anything that renders.

The catalog owns the registry instance and the address-side answers — `iconFor`, `isDocument`, `isResident`,
the route contract, and the register/unregister boundary. It imports the registry factory and nothing else.
views.jsx imports the catalog, seeds the product's views into it as `core`, and keeps `viewFor` with the
components it names.

## Why the split is load-bearing

Before it, the tab machinery reached those answers through views.jsx, which statically imports SessionsView
so a dispatched compose always lands on a mounted receiver. That one eager edge made
`views.jsx → SessionsView → SessionInterface → TabStrip → views.jsx` a real import cycle — twelve modules,
including the whole session interface — closed around three questions that never needed a component. The
eager receiver is deliberate and stays; what moved is the question, to a module that has no reason to know
any view exists.

So the direction is fixed: the catalog knows no view, views.jsx knows the catalog, and everything that
merely asks about a page kind reads the catalog. A consumer that imports views.jsx for `isDocument` has
re-formed the cycle even if nothing visibly breaks.

## Seeding

The catalog starts empty and `seedCoreViews` is called once, by views.jsx, at module evaluation. Every
lookup here runs inside a React render or an event handler, never at module scope, and the render tree that
hosts them is mounted by the shell — which imports views.jsx for `viewFor`. That import is what orders
seeding before the first lookup; it is a real dependency, not a side-effect import kept alive by convention.
