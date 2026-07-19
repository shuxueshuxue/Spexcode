---
scenarios:
  - name: registry-roundtrip
    tags: [frontend-e2e, backend-api]
    test:
      path: spec-dashboard/src/identity-presets.test.mjs
      name: preset and legacy href cases
    description: >-
      Exercise registry ids, aliases, validation, SVG/favicon serialization, and legacy URL/Iconify/emoji
      values; then inspect the real browser favicon and picker in the complete identity-chain run.
    expected: >-
      Every preset has one labeled data row and local SVG href; validation accepts only picker presets;
      existing URL/Iconify/emoji values retain their old output; browser swatches and favicons match.
---

Unit output proves exact serialization; the browser eval proves the renderer consumes it.
