---
scenarios:
  - name: complete-identity-chain
    tags: [frontend-e2e, desktop, mobile]
    description: >-
      Drive an isolated real gateway and two real project backends in Chromium. As admin, use the visual
      gateway and per-project icon disclosures by mouse and keyboard; confirm every full chooser is absent
      on initial `/projects`, reveal its compact searchable/source-filtered browser, and select both a
      featured preset and Iconify values outside that featured set. Switch projects; reload; restart the
      gateway and backends; stop one backend and edit its icon offline; revisit `/projects` and each scoped
      route at desktop and 390px under multiple themes. Also open a project-only guest session.
    expected: >-
      Initial project and gateway controls show only compact current-icon previews plus named edit buttons;
      no `fieldset.identity-picker` exists until disclosure. The revealed browser is compact and
      non-overlapping, its result radios have accessible names and native arrow-key movement, and a
      successful canonical save re-collapses it. Gateway edits touch only the host config; project edits
      touch only that project's `dashboard.icon`, including offline. Iconify choices outside the featured
      eight survive reload/restart and drive the same project row, switcher, rail, and favicon value; the
      gateway choice drives its tab too. Themes remain legible, the 390px layout does not overlap, project
      switching never leaks the last identity, and a guest sees neither catalog nor management controls.
    test: spec-dashboard/test/identity-chain.e2e.mjs
    related:
      - spec-cli/src/host.test.ts
      - spec-dashboard/src/projects.test.mjs
---
# measuring project identity

This is a multi-step interaction, so file a video with an exported time-axis step map. File settled
desktop/mobile/theme screenshots beside it, and a transcript for the isolated processes/config assertions.
