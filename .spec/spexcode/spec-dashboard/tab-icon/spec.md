---
title: tab-icon
hue: 190
desc: The browser-tab favicon is the route-selected resolved identity rendered from the shared icon preset registry.
code:
  - spec-dashboard/index.html
related:
  - spec-cli/src/graph.ts
  - spec-cli/src/layout.ts
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/IdentityIcon.jsx
---
# tab-icon

The sibling of [[tab-title]]: every tab projects the icon belonging to its current pathname scope. A project
stores its chosen value in `spexcode.json` `dashboard.icon` (picker presets plus preserved legacy
emoji/Iconify/URL forms); the global gateway stores its preset only in the
host config described by [[identity-config]]. The backend and catalog expose resolved identities, and
[[project-identity]] selects the gateway record for `/projects` or the matching project row for `/p/<id>/`.

Favicon SVG/data-URI generation comes from [[icon-presets]], the same registry and serializer the visible
marks use. `index.html` contains only the link mount and plain title fallback, never a second hand-written
icon. Missing settings resolve to stable SpexCode/gateway defaults, so every loaded face gets a favicon;
switching scope or changing a preset updates the existing link live and survives reload/restart through its
canonical source.
