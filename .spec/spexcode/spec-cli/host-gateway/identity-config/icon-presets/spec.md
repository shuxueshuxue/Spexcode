---
title: icon presets
hue: 185
desc: The one data registry for identity icon presets, validation, aliases, SVG serialization, and favicon hrefs.
code:
  - spec-cli/src/identity-presets.js
related:
  - spec-cli/src/identity-presets.d.ts
  - spec-dashboard/src/IdentityIcon.jsx
---
# icon-presets

Identity icons are named data rows, not page-local drawings. One browser-safe registry owns every preset's
stable id, accessible label, palette, view box, and geometry; both backend validation and the dashboard
renderer consume it. The existing `dashboard.icon` field stores that human-readable value. Emoji, arbitrary
Iconify names, and URLs remain valid through the same adapter; picker writes use canonical registry ids.

The same serializer produces browser favicon data URLs from a registry row, so the visual picker, project
rows, scoped rail, global gateway mark, and browser tab cannot drift into separate variants. Missing values
use the documented default; structured host writes reject unknown preset choices before touching disk
without invalidating legacy values already authored directly.
