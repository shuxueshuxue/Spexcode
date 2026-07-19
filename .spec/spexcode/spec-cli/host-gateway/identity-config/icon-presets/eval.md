---
scenarios:
  - name: registry-roundtrip
    tags: [frontend-e2e, backend-api]
    test:
      path: spec-dashboard/src/identity-presets.test.mjs
      name: preset and legacy href cases
    description: >-
      Exercise featured registry ids, aliases, structured-choice validation, SVG/favicon serialization,
      broad Iconify names, and legacy URL/Iconify/emoji values; then inspect the real browser favicon and
      compact searchable chooser in the complete identity-chain run.
    expected: >-
      Every featured preset has one labeled data row and local SVG href; validation accepts featured ids and
      well-formed Iconify names while rejecting other new arbitrary values; existing URL/Iconify/emoji values
      retain their old output. Browser results, visible marks, and favicons resolve from the same saved value.
---

Unit output proves exact serialization; the browser eval proves the renderer consumes it.
