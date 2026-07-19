---
title: icon presets
hue: 185
desc: The one identity icon resolver over local presets and the established Iconify namespace, including validation, aliases, SVG serialization, and favicon hrefs.
code:
  - spec-cli/src/identity-presets.js
related:
  - spec-cli/src/identity-presets.d.ts
  - spec-dashboard/src/IdentityIcon.jsx
---
# icon-presets

Identity icons are named values, not page-local drawings. One browser-safe resolver owns the small featured
registry's stable ids, accessible labels, palette, view box, and geometry, plus the established broad Iconify
`prefix:name` namespace that the original tab identity accepted through `api.iconify.design`. Backend
validation, the dashboard renderer, and the compact searchable/source-filtered chooser consume that same
contract. The existing `dashboard.icon` field stores the chosen human-readable value; no catalog result is
copied into another identity field. Emoji, arbitrary Iconify names, and URLs already authored directly remain
valid through the adapter; structured chooser writes accept canonical registry ids and well-formed Iconify
names, while rejecting other new arbitrary strings.

The same serializer produces browser favicon data URLs from a registry row, so the visual picker, project
rows, scoped rail, global gateway mark, and browser tab cannot drift into separate variants. Missing values
use the documented default; structured host writes reject malformed choices before touching disk
without invalidating legacy values already authored directly.
