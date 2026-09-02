---
scenarios:
  - name: host-card-matches-cli
    tags: [frontend-e2e, cli]
    description: >-
      With `spex dashboard` running, open the projects hub in a real browser and read the host card; run
      `spex doctor` at host scope in a terminal.
    expected: >-
      Runtime, node, tmux, git, agent-login and launcher-resolution facts on the card equal the CLI's, field for
      field; a deliberately broken launcher path in .spec/spexcode.local.json is named by both.
    related: [spec-dashboard/src/ProjectsPage.jsx, spec-cli/src/doctor.ts]
  - name: serve-failure-links-to-host
    tags: [frontend-e2e]
    description: >-
      Remove tmux from PATH for the gateway, then press Open on an offline project.
    expected: >-
      The project's result block shows the serve failure naming tmux and links to the host card; no second
      diagnosis UI appears and the project's settings page is unchanged.
    related: [spec-dashboard/src/ProjectsPage.jsx]
  - name: gateway-record-published
    tags: [cli]
    description: >-
      Start `spex dashboard`, read the host record, kill -9 the gateway, read again.
    expected: >-
      The record names the live pid/instance and validates; after the kill a reader reports no gateway rather
      than the dead url.
    related: [spec-cli/src/host.ts]
---
# eval.md - host-facts
