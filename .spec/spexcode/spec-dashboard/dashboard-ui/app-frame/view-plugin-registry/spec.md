---
title: view-plugin-registry
status: active
hue: 225
desc: Governed runtime extension boundary for dashboard views.
code:
  - spec-dashboard/src/viewRegistry.js
related:
  - spec-dashboard/src/viewRegistry.test.mjs
  - spec-dashboard/src/views.jsx
  - spec-dashboard/src/builtInViewPlugins.js
---
# view-plugin-registry

The dashboard's core views are seeded into one runtime registry. Built-in extensions and later external
extensions use
`registerView(name, definition, owner)` or `registerPlugin({ id, views })`; they do not mutate the built-in
map. Names are lowercase kebab-case and definitions provide a component function. Registration fails closed
when a name is already owned, and plugin registration validates every definition before changing the registry,
so a collision or invalid definition cannot leave a partial plugin behind. Unregistering a plugin removes only
views owned by that plugin. The registry is a view-extension seam, not a second router: route parsing and tab
identity remain shell-owned, and every registered view receives the same `{ param, query }` contract as a built-in.

Settings is the first real built-in extension consumer. Dashboard startup registers its existing `settings`
view through `registerPlugin`, including the same route, resident-tab, icon, surface, and class metadata that
the shell already consumes. It is not seeded as a core view and does not acquire a plugin-only navigation
path: `#/settings`, the rail, the tab strip, and `viewFor` continue through the one route and registry grammar.
This proves the extension seam with a product view without inventing an external discovery or loading protocol.
