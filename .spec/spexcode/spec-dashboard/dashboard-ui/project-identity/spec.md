---
title: project identity
hue: 175
desc: Route-selected gateway/project identity rendered through one shared icon component and admin-only catalog picker.
code:
  - spec-dashboard/src/IdentityIcon.jsx
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/ProjectsPage.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/projects.js
  - spec-dashboard/src/identity-presets.test.mjs
  - spec-dashboard/test/identity-chain.e2e.mjs
---
# project-identity

The pathname selects identity. `/projects` renders the gateway projection from the authorized catalog;
`/p/<id>/` selects only that id's catalog row. The board projection is the compatibility/direct-serving
fallback, never a last-loaded or session-local cache. If catalog access is denied, a project guest may use
its authorized board identity but receives no fleet data or management control.

`IdentityIcon` and `IdentityPicker` are the one renderer and chooser over [[icon-presets]]. The renderer
supplies every swatch, row mark, rail chip, and favicon. The chooser keeps the local presets as featured
choices and restores the established broad Iconify namespace through a compact searchable, source-filtered
browser; its results use native radio semantics with accessible names, keyboard movement, theme tokens, and
a narrow responsive grid. On the admin Projects face, both
project and gateway identity use the same quiet disclosure: a compact current-icon preview beside one
familiar edit button, with every full chooser absent until explicitly opened and closed again after a
successful choice. Project disclosure lives inside its existing setup/details drawer; gateway disclosure
lives in the page's low-priority settings/details area. Both call the host's structured writes.

Every visible projection consumes the selected resolved identity: global branding and tab metadata use the
gateway; project rows, switcher rows, scoped current-project mark, tab metadata, session header, and graph
brand use the scoped project. A catalog refresh changes those projections live without copying icon state
into a route or browser preference. The project switcher renders each catalog project's identity in one
fixed mark slot before its name and renders the catalog gateway identity for its global Projects row;
locks and the current-project check remain independent trailing/adjacent status projections.
