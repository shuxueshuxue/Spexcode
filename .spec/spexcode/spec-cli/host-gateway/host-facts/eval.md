---
scenarios:
  - name: host-card-matches-cli
    tags: [frontend-e2e, cli]
    description: >-
      With `spex dashboard` running, open the projects hub in a real browser and read the host card; run
      `spex doctor` at host scope in a terminal.
    expected: >-
      Runtime, node, tmux, git and agent-login facts on the card equal the CLI's, field for field. Launcher rows
      are host-level noise and appear on NEITHER the card's standing rows: a deliberately broken launcher path in
      .spec/spexcode.local.json is named by the CLI and by the card's host-doctor result block, never as a project-qualified
      row on the cross-project panel.
    related: [spec-dashboard/src/ProjectsPage.jsx, spec-cli/src/doctor.ts]
  - name: no-memory-envelope-on-the-host-surfaces
    tags: [frontend-e2e, cli]
    description: >-
      Read the host card in a real browser and `spex doctor --host` in a terminal, then read `GET /host`'s
      payload. Run the CLI half a second time from inside a cgroup that really is capped
      (`systemd-run --user --scope -p MemoryMax=8G`), where a cap reader would have something to report.
    expected: >-
      No surface mentions a memory envelope: no row or line about a cap, no `cgroup`/`.wslconfig` word, and no
      `memory` key in the payload — including inside the capped scope, where the removal is visible as silence
      rather than as a missing value. `spex session resources` still answers about per-process ownership, which is
      the different question this product does render.
    related: [spec-cli/src/host-facts.ts, spec-dashboard/src/ProjectsPage.jsx, spec-cli/src/doctor.ts]
  - name: serve-failure-links-to-host
    tags: [frontend-e2e]
    description: >-
      Start the gateway with a PATH that cannot run a backend (hide `git`), then press start on an offline
      project. Then repeat with only `tmux` hidden.
    expected: >-
      The failing case shows the failure in the project's OWN row — the reason and its serve.log — with one
      link into the host card ("see host facts"); exactly one host card exists on the page and no second
      diagnosis UI appears. Hiding only tmux is NOT a failing case: process-host hosting takes over, the
      backend comes online, and the row's action becomes open — so a scenario expecting a tmux-named serve
      failure would be measuring behavior this product no longer has.
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
