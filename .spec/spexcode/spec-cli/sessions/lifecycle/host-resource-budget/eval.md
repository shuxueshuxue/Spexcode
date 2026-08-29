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
  - name: unresolvable-harness-record-keeps-the-host-report
    tags: [cli, backend-api]
    description: >-
      In an isolated throwaway project with its own SPEXCODE_HOME, runtime directory, and backend port, hold two
      governed session records: one naming a harness id the running registry resolves and one naming an id it
      cannot. That second state is what a removed plugin harness or a renamed harness id leaves behind; the public
      create path validates the harness, so the record is placed in that state directly while every read under
      measurement goes through the public surface. Read the host resource report through `GET /api/resources` and
      through `spex session resources` in text and JSON.
    expected: >-
      The read returns a report rather than failing. Every resolvable owner still carries its own findings, and the
      unresolvable record remains a visible session owner whose findings name the unknown harness id, with reclaim
      ineligible because stop safety cannot be proven for a harness the registry cannot resolve. One unreadable
      record never removes another owner's findings.
  - name: leaf-identity-changes-during-stop-guard
    tags: [backend-api]
    code: spec-cli/src/sessions.ts#killAgentProcess
    description: >-
      Against an isolated real child registered as one session's exact leaf, enter the ordinary stop transition
      and hold the adapter-owned shared-runtime guard before an escalation signal. Let that exact child exit
      while the guard is pending, then release the guard while observing the OS signal boundary.
    expected: >-
      After the guard returns, stop re-reads the leaf PID/start identity and its session ownership evidence
      immediately before signaling. A missing or changed instance blocks that escalation with zero TERM/KILL
      signal attempts; no PID value remembered before the guard grants later signal authority.
  - name: retired-session-does-not-own-shared-tmux-tree
    tags: [backend-api]
    test:
      path: spec-cli/src/host-resources.test.ts
      name: resource walk does not charge a shared tmux tree to a retired instance token
    description: >-
      On an isolated host-resource backend fixture, start one tmux server with windows for a retired session and
      a live sibling, plus a foreign process. Give the shared server the retired launch environment and read the
      report through the backend API/resource collector.
    expected: >-
      The retired orphan row contains only its own exact launch lineage, or no processes when that lineage is
      absent. The tmux server, the live sibling window/processes, and the foreign process never appear under that
      retired orphan owner; shared host cost remains a shared-runtime/host row or explicit unattributed finding.
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
