---
scenarios:
  - name: merge-dispatch-keeps-landing-local
    tags: [backend-api, cli]
    test: { path: spec-cli/src/session-merge-dispatch.api.test.ts, name: "merge dispatch gives the agent the short local landing flow" }
    code: [spec-cli/src/session-merge-dispatch.api.test.ts]
    related: [spec-cli/src/index.ts, spec-cli/src/client.ts, spec-cli/src/cli.ts]
    description: >
      Through the real backend and real CLI, create a governed fake-harness session. Verify a merge request is
      refused before `done --propose merge`, then declare merge and dispatch it with the bodyless CLI operation.
      Read the resulting sent timeline entry.
    expected: >
      An undeclared merge fails loudly. A declared merge appends one ordinary prompt that tells the session agent
      to sync and resolve conflicts in its own worktree, re-run proof, atomically land one completed branch with
      `--no-ff` into main, and verify the result. The prompt contains no reviewed SHA, epoch, request key, shell
      program, hex encoding, or special success token.
  - name: codex-command-box-terminal-delivery
    tags: [backend-api, frontend-e2e, desktop]
    test: { path: spec-dashboard/test/command-box.e2e.mjs, name: "Command Box keeps a terminal delivery outcome" }
    description: >-
      Through Vite and a real headed Codex session on the shared project app-server, send from the Command Box
      once while its thread is idle and once while a turn is in progress; then exercise a delayed response,
      a lost confirmation, and a replay carrying the same delivery marker.
    expected: >-
      Idle delivery is native turn/start and in-turn delivery is native turn/steer; only a native accepted result
      clears the Command Box. A native rejection and a post-write lost confirmation remain distinct structured
      outcomes with the draft retained. A replay of the unchanged marker returns the recorded first outcome and
      creates no second native turn.
---
