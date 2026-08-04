---
scenarios:
  - name: merge-dispatch-is-durable-idempotent
    tags: [backend-api]
    test: { path: spec-cli/src/session-manager-authority.api.test.ts, name: "public review and merge authority bind exact head and one durable dispatch" }
    code: [spec-cli/src/sessions.ts#mergeSession]
    related: [spec-cli/src/session-timeline.ts, spec-cli/src/index.ts, spec-cli/src/client.ts]
    description: >
      Against two real same-host backends sharing one isolated project and store, create the governed
      fake-harness session used by the exact-head review control. First POST merge without an Idempotency-Key
      using invalid JSON, `null`, and an extra-field body. Then remove only the fake harness rendezvous pathname
      while its owned pane process remains live, concurrently POST the same caller key and reviewed head through
      both backends, stop both backends, restart one on the same store, and replay. Reuse the key with the other
      committed head, submit a fresh key with that stale head, and submit fresh keys while the session worktree
      is detached and while another branch is checked out. Read the public timeline and pending debt.
    expected: >
      Every unkeyed request preserves the old `{dispatched:true}` interface without parsing or rejecting its
      body. Across the concurrent keyed requests exactly one appends a merge prompt and one reports replay; the
      undeliverable prompt leaves exactly one pending debt. The restart replay reports the durable acceptance
      and leaves both timeline and debt single. Reusing the key with another reviewed head returns HTTP 409
      `session_merge_key_reused`; a fresh stale head returns `session_merge_head_changed`; detached and
      wrong-branch worktrees return `session_merge_branch_unproven`; none appends. The one keyed prompt binds the
      reviewed object, requires the agent to re-prove worktree/symbolic-branch/stored-ref identity before change,
      and after sync merges the freshly frozen tested object rather than a branch name. No raw key is retained.
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
