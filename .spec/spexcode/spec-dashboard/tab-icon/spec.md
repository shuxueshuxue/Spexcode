---
title: tab-icon
hue: 190
desc: The browser-tab favicon — a configured dashboard.icon (an emoji or an Iconify name) injected at runtime, with an on-brand default so every tab has one. No asset to download or vendor.
code:
  - spec-dashboard/index.html
related:
  - spec-cli/src/graph.ts
  - spec-cli/src/layout.ts
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
---
# tab-icon

The sibling of [[tab-title]]: where that names the tab, this gives it a **favicon** — so a dashboard the
agent built is recognisable at a glance, and several project boards open at once are tellable apart by icon
as well as name. The whole point is **no asset to download or vendor into source**: an agent picks an icon
by *naming* one, and it just appears.

A project sets `dashboard.icon` in its `spexcode.json` (the same per-project block as `dashboard.title` /
`dashboard.apiUrl`). It accepts three painless forms, none needing a shipped file:

- an **emoji or glyph** (`"🔭"`, `"🛰️"`) — rendered into an inline SVG data-URI, zero network;
- an **Iconify name** (`"mdi:rocket-launch"`, `"lucide:radar"`) — resolved to its CDN SVG at
  `api.iconify.design` (200k+ icons across 150+ sets: Material, Lucide, Tabler, Phosphor, Simple Icons…);
- a **full URL** — used as-is.

Like the title, it rides the `/api/graph` poll: `board.projectIcon` carries the configured value, so it
re-derives from whichever backend the viewer actually reached, and pointing the same board at a different
backend re-icons the tab. The frontend resolves the value through one helper (`faviconHref`) and sets a
`<link rel="icon">` at runtime. With no `dashboard.icon` configured the field is empty and the runtime leaves
the tab on the **default** the html ships — the SpexCode mark (a spec-tree glyph over a compass arc) as an
inline SVG, the pre-load fallback, mirroring how `index.html` ships the plain `SpexCode` title. So every tab
has *some* icon with zero config, and a one-line config swaps it for a chosen one.

This is the **non-invasive** path the surface is built for: an agent gives the page an identity by editing
config, never the source — the mechanism is built once, used by naming. The `projectIcon` field is tab-icon's
only stake in `graph.ts` (produced by the shared `buildBoard`, alongside [[tab-title]]'s `project`); a change
there that leaves the icon derivation untouched is another feature's stake, not tab-icon's drift.
