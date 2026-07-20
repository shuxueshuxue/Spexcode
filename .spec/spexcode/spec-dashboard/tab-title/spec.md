---
title: tab-title
status: active
hue: 190
desc: The route-selected resolved identity names the browser tab and project-owned identity surfaces.
code:
  - spec-dashboard/index.html
related:
  - spec-cli/src/graph.ts
  - spec-cli/src/layout.ts
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/IdentityIcon.jsx
  - spec-dashboard/src/SessionInterface.jsx
---
# tab-title

The dashboard is project-agnostic, so the route-selected [[project-identity]] names its tab. `/projects`
uses the gateway identity; `/p/<id>/` uses exactly that catalog row, with the authorized board identity as
the direct-serving/guest compatibility source when no catalog is available. A board from another backend
can never rename a scoped catalog route.

Project titles come from `dashboard.title`, else the canonical project-root basename. The fixed gateway
title identifies the global Projects face. The tab is exactly the resolved scope title — no product
suffix — so several open scopes read apart by name alone; the product brand lives in the favicon and
wordmark, never the tab text. One projection helper turns the resolved identity into the tab, shared by
every route.

That name is read through one resolved identity helper, so any surface
that needs to say *which* project shares one source rather than re-deriving it. The **session
board**'s left-hand list header reuses it: the translated `// {sessions}` header ([[settings]])
gains the project name as `// <project> {sessions}`, self-identifying the board the way the tab
self-identifies the window — the same payoff when several project boards sit open at once. With no
name resolved it falls back to the plain translated header. The **graph HUD brand** — the shell-prompt
line pinned top-left over the node graph — reuses it too, reading `$ <project>` from the same helper so
the on-canvas identity matches the tab and board rather than a hardcoded package name; before the first
board loads it falls back to the plain `spec-dashboard` label.

`index.html` ships a plain `SpexCode` title before identity resolves. The board carries one `{title, icon}`
projection rather than parallel name/icon settings; catalog rows carry the same shape.
