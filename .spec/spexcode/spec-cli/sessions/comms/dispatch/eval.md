---
scenarios:
  - name: merge-dispatch-is-durable-idempotent
    tags: [backend-api]
    test: { path: spec-cli/src/session-manager-authority.api.test.ts, name: "public review and merge authority bind exact head and one durable dispatch" }
    code: [spec-cli/src/sessions.ts#mergeSession]
    related: [spec-cli/src/session-timeline.ts, spec-cli/src/index.ts, spec-cli/src/client.ts]
    description: >
      Against two real same-host backends sharing one isolated project and store, create the governed
      fake-harness session used by the exact-head review control. Attempt merge while it is active and while it
      proposes `nothing`; then declare merge. Submit missing/malformed authority and move each reviewed ref in
      turn. Remove only the fake harness rendezvous pathname while its owned pane remains live, concurrently POST
      the same caller key and exact branch/base pair through both backends, stop both backends, restart one on the
      same store, and replay. Reuse the key with another pair on that session; create another governed session and
      use the same raw key for its own reviewed pair; then submit fresh keys while the first worktree is detached
      and while another branch is checked out. Read both records, raw/public timelines, and pending debt.
    expected: >
      Active, non-merge-proposal, unkeyed, missing-field, malformed, stale-branch, and stale-base requests fail
      before lifecycle/timeline/queue mutation. Across the concurrent valid requests exactly one appends a merge
      prompt and one reports replay; the undeliverable prompt leaves exactly one pending debt. Restart replay
      reports the durable acceptance and leaves timeline/debt single. Reusing the key with another pair returns
      HTTP 409 `session_merge_key_reused`, while the other session independently accepts the same raw key once;
      detached and wrong-branch worktrees return
      `session_merge_branch_unproven`; none appends. The accepted prompt binds both reviewed objects, requires the
      agent to re-prove worktree/symbolic-branch/stored-branch/canonical-base identity before change, and after
      sync merges the freshly frozen tested object rather than a branch name. No raw key is retained anywhere.
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
