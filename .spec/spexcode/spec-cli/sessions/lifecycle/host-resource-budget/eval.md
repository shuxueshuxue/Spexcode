---
scenarios:
  - name: shared-sibling-survives-target-stop
    tags: [cli, backend-api]
    description: >-
      In an isolated throwaway project, launch two real Codex sessions on one shared app-server and wait for
      both turns to become addressable. Record the exact app-server generation, both records, worktrees, and
      branches. Stop the session that launched the shared runtime through the existing public session stop CLI,
      then send the sibling a new turn through the public CLI.
    expected: >-
      Stop terminates only the target leaf and marks that record offline while preserving its record, worktree,
      branch, and unmerged bytes. The app-server keeps the same PID/start generation, the sibling stays online,
      and its new turn runs in its own worktree. No target pane or ancestor teardown interrupts the sibling or
      changes its lifecycle state.
  - name: resource-inventory-surface
    tags: [cli, backend-api]
    description: >-
      Against an isolated throwaway backend with real session leaves and a real shared Codex runtime, run
      `spex session resources` in text and JSON and request `GET /api/resources`. Cross-check its exact owners
      against narrow `/proc`, tmux, backend registry, port, session-record, worktree, and branch observations.
    expected: >-
      CLI and API return the same read-only snapshot: host memory/swap/CPU, every attributable session and
      backend owner, exact PID/start identities, RSS/PSS and sampled CPU against budgets, shared loaded/active
      references, orphan/identity-leak findings, advisory eligibility, and explicit unattributed cost. The read
      creates no plan or mutation token and changes no process, record, worktree, branch, port, or health state.
---

# eval.md - host resource budget

Measure through the real `spex session` CLI and backend API. Synthetic process tables may test narrow parser
edges, but closure requires real child processes, process-start identities, shared Codex control, and the public
surface named by each scenario.

Run each scenario in a disposable Git clone with its own `SPEXCODE_HOME`, runtime directory, backend ports, and
Codex app-server socket. Never point a failure step at the development project's runtime. Start the backend
through the package's public launcher and create/control sessions through the public API/CLI. Record only
sanitized owner ids, PID/start identities, counts, verdicts, health, RSS/CPU/swap, and worktree/branch existence;
do not archive raw environments, full process dumps, or conversations.
