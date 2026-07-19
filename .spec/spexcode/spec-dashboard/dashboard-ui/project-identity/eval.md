---
scenarios:
  - name: complete-identity-chain
    tags: [frontend-e2e, desktop, mobile]
    description: >-
      Drive an isolated real gateway and two real project backends in Chromium. As admin, use the visual
      gateway and per-project preset pickers by mouse and keyboard; switch projects; reload; restart the
      gateway and backends; stop one backend and edit its icon offline; revisit `/projects` and each scoped
      route at desktop and 390px under multiple themes. Also open a project-only guest session.
    expected: >-
      Preset radios have accessible names and native arrow-key movement; successful saves settle from the
      canonical response. Gateway edits touch only the host config; project edits touch only that project's
      `dashboard.icon`, including offline. Picker choices survive reload/restart, catalog/rows/rail/title/
      favicon all agree by route, themes remain legible, narrow layout does not overlap, project switching
      never leaks the last identity, and a guest sees neither catalog nor management controls.
    test: spec-dashboard/test/identity-chain.e2e.mjs
    related:
      - spec-cli/src/host.test.ts
      - spec-dashboard/src/projects.test.mjs
---
# measuring project identity

This is a multi-step interaction, so file a video with an exported time-axis step map. File settled
desktop/mobile/theme screenshots beside it, and a transcript for the isolated processes/config assertions.
