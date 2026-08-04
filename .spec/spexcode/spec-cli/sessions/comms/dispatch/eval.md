---
scenarios:
  - name: merge-dispatch-is-durable-idempotent
    tags: [backend-api]
    test: { path: spec-cli/src/session-manager-authority.api.test.ts, name: "public review and merge authority bind exact head and one durable dispatch" }
    code: [spec-cli/src/sessions.ts#mergeSession]
    related: [spec-cli/src/session-timeline.ts, spec-cli/src/index.ts, spec-cli/src/client.ts]
    description: >
      Against the same isolated real backend and governed fake-harness session used by the exact-head review
      control, POST merge twice with one caller-chosen `Idempotency-Key` and the returned `reviewedHead`, then
      restart the backend on the same isolated store before the replay, then reuse that key with the other
      committed head. Read the public session timeline after every request.
    expected: >
      The first request appends exactly one merge prompt and reports a fresh accepted dispatch. The identical
      replay reports the durable prior acceptance and leaves both the sent timeline and pending delivery debt
      single. Reusing the key with another reviewed head returns HTTP 409 with
      `session_merge_key_reused` and appends nothing. A fresh key carrying a stale reviewed head returns HTTP
      409 `session_merge_head_changed`, also with no receipt. No raw idempotency key is stored or returned.
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
