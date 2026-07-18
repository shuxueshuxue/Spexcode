---
scenarios:
  - name: configured-and-default
    tags: [frontend-e2e, desktop]
    description: >
      Load the dashboard with no dashboard.icon set and screenshot the browser tab / inspect the
      <link rel="icon"> href; then set dashboard.icon to an emoji and to an Iconify name, reload, and
      re-inspect — the favicon must change to match each.
    expected: |
      With nothing configured, the tab shows the default SpexCode mark (a tidy-tree glyph — a root node
      bezier-linked to two children — on a violet→fuchsia gradient tile) shipped by index.html (the <link rel="icon"> resolves to that inline SVG data-URI). Setting dashboard.icon to an emoji
      (e.g. "🛰️") makes the runtime swap the favicon to that emoji's inline SVG; setting it to an Iconify
      name (e.g. "mdi:rocket-launch") points the favicon at https://api.iconify.design/mdi/rocket-launch.svg.
      No vendored/downloaded asset is involved in any case.
    code: spec-dashboard/index.html
    related:
      - spec-dashboard/src/data.js
      - spec-dashboard/src/App.jsx
---
# tab-icon loss

YATU through the real page: open the dashboard in a browser and read the actual `<link rel="icon">` the
document carries (and the rendered tab), for the unconfigured default and for a configured emoji / Iconify
name — not the helper in isolation. `faviconHref` is the unit under it, but the measured truth is the
favicon the browser actually shows.
