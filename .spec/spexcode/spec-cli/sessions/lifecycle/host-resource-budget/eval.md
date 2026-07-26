---
scenarios:
  - name: inventory-budget-and-shared-guard
    tags: [cli, backend-api]
    description: >-
      Against a real throwaway backend and real shared runtime, launch governed session leaves, retain at least
      two loaded sibling threads, and leave one reparented descendant whose retired owner record/worktree are
      gone. Run the public resource report in text and JSON, then attempt the existing public stop action while
      independently removing the shared PID, start identity, and isolation proof.
    expected: >-
      The report joins every attributable process to its session or project owner, reports exact PID plus start
      identity, RSS/PSS and sampled CPU against configured budgets, distinguishes active/loaded/unowned-live
      references from record-only and queued-without-thread entries, and keeps unattributed cost visible. The
      proven orphan is advisory-eligible but receives no token. Every missing PID/start/isolation attempt fails
      closed before a signal, as do an unhealthy probe and an unowned loaded thread even with otherwise-valid
      identity artifacts. Attribution stays degraded for a correct repository trailer that no exact thread turn
      was observed producing. The session leaves, shared control plane, sibling records, worktrees, and branches
      remain intact.
  - name: restart-attribution-and-exact-reclaim
    tags: [cli, backend-api]
    description: >-
      In an isolated throwaway project with two real Codex sibling sessions on one shared app-server, capture
      their exact runtime generation and attribution state, restart that app-server through its adapter-owned
      recovery path, then make each resumed sibling run a shell tool and create a normal commit. Exercise the
      existing public stop/close surface with the exact resource plan while one sibling remains live, and with
      the target instance independently replaced between planning and mutation.
    expected: >-
      Merely resuming a turn never marks attribution ready. Each sibling regains its own worktree cwd, hook
      delivery, per-thread session environment, and correct Session trailer before its exact post-restart turn
      and commit observation can become ready. No sibling inherits another session's identity. The resource
      plan is bound to immutable owner identities and current shared references; a stale token, PID reuse,
      changed start token, unowned loaded thread, unhealthy probe, or missing isolation proof fails closed before
      any signal. A valid plan flows through the same exact-instance primitive used by ordinary stop/close,
      terminates only the proven target leaf, and leaves the shared app-server, active sibling, worktrees,
      branches, production endpoints, and unrelated sessions intact.
---

# eval.md - host resource budget

Measure through the real `spex session` CLI and backend API. Synthetic process tables may test narrow parser
edges, but closure requires real child processes, process-start identities, shared Codex control, and the public
report plus fail-closed stop guard.

Run both scenarios in a disposable Git clone with its own `SPEXCODE_HOME`, runtime directory, backend ports,
and Codex app-server socket. Never point a failure-injection step at the development project's runtime. Start
the backend through the package's public launcher, create sessions through the public API/CLI, and query the
same backend through `spex session resources` in text and JSON. For each fail-closed leg, restore the fixture
and remove or replace exactly one PID/start/isolation/reference fact so the transcript identifies which proof
was absent. Record only sanitized owner ids, PID/start identities, counts, verdicts, health, RSS/CPU/swap, and
worktree/branch existence; do not archive raw environments, full process dumps, or conversations.

For restart attribution, deliberately replace only the throwaway adapter-owned app-server. Resume both exact
threads through the product, have each run a shell command that prints its cwd plus the narrow session-id
variable, then make a normal commit through that resumed turn without manually supplying a trailer. Compare
the public resource evidence to the immutable commits and their trailers. A raw Git commit made outside the
observed thread is a negative control only and must remain degraded.
