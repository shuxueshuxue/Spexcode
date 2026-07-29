---
scenarios:
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
