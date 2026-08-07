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
      and while another branch is checked out. Submit a full-length object id absent from the repository. For a
      separate session, race two same-key requests and kill the isolated backend exactly after receipt append and
      before queue rename, restart, and replay. In another isolated session, kill the backend after the adapter's
      one handover and settlement append but before pending removal; then restart both backend and agent. After one
      settled handover, set the first fixture active and later archive it, replaying in both states. Read records,
      raw/public timelines, native fake-harness output, and pending debt.
    expected: >
      Active, non-merge-proposal, unkeyed, missing-field, malformed, stale-branch, and stale-base requests fail
      before lifecycle/timeline/queue mutation. Across the concurrent valid requests exactly one appends a merge
      prompt and one reports replay; the undeliverable prompt leaves exactly one pending debt. Restart replay
      reports the durable acceptance and leaves timeline/debt single. Reusing the key with another pair returns
      HTTP 409 `session_merge_key_reused`, while the other session independently accepts the same raw key once;
      detached and wrong-branch worktrees return `session_merge_branch_unproven`, and a nonexistent full object id
      returns structured `session_merge_head_changed`; none mutates. A crash between receipt and queue leaves one
      public timeline line and no debt even with the second same-key request in flight; restart replay reconstructs
      the one canonical keyed pending shape and produces exactly one native handover. If the process instead dies
      after settlement but before pending removal, restart consumes that already-settled exact debt without a second
      adapter call; after the agent also restarts, old-plus-new native output still contains exactly one handover and
      the queue is absent. Missing/mismatched receipt identity remains owed and stops the pass. Replays after that
      settlement, including after active and archived transitions, preserve record bytes, queue, and native delivery
      count exactly. The accepted prompt binds both reviewed objects, requires the
      agent to re-prove worktree/symbolic-branch/stored-branch/canonical-base identity before change, and after
      sync merges the freshly frozen tested object rather than a branch name. No raw key is retained anywhere.
  - name: merge-prompt-gates-are-observable
    tags: [backend-api, cli]
    test: { path: spec-cli/src/session-merge-prompt-observability.api.test.ts, name: "the dispatched merge prompt reports a distinguishable gate verdict" }
    code: [spec-cli/src/sessions.ts#mergePrompt]
    description: >
      Through the real backend, create a governed fake-harness session, commit lane work, advance the base
      under it, take the exact-head review, declare merge, and POST the keyed merge dispatch. Read the
      delivered prompt off the session timeline and extract its step 0 and step 2 shell blocks the way an
      executor would — the lines that open with an assignment or a command, shape-agnostic. Run the step 0
      block with a real shell in the exact reviewed state, then once per falsified item: the base ref moved,
      the worktree HEAD detached, the branch moved past its review, the worktree gone. Run the step 2 block
      before syncing, while the branch does not yet contain the base, and again after. Read each run's stdout,
      the item labels the block itself carries, the checks its verdict line conjoins, and the base ref before
      and after every landing attempt.
    expected: >
      The reviewed state prints REVIEWED_GENERATION_OK. Every falsified run prints no OK token, differs from
      the passing run's output (4 of 4), and names its failing item — 5/baseref, 2/symbolic, 3/wtHEAD,
      1/toplevel. The block itself names all five items (1/toplevel, 2/symbolic, 3/wtHEAD, 4/mainref,
      5/baseref) and its verdict line still conjoins exactly five checks, so observability dropped none of
      them. Landing before the sync prints no LANDING_MERGED, names 3/ancestor, and leaves the base ref
      untouched; after the sync it prints LANDING_MERGED for the frozen candidate and the base advances by
      exactly one merge commit.
  - name: merge-prompt-gates-survive-a-lossy-executor
    tags: [backend-api, cli]
    test: { path: spec-cli/src/session-merge-prompt-ascii.api.test.ts, name: "the dispatched merge prompt gates a unicode branch in pure ASCII" }
    code: [spec-cli/src/sessions.ts#shAscii]
    related: [spec-cli/src/sh.ts]
    description: >
      Through the real backend, create a governed session from a CJK ask so that both the branch ref and the
      worktree path carry bytes above 0x7F; commit lane work, advance the base, take the review, declare merge,
      and POST the keyed merge dispatch. Take the step 0 and step 2 blocks off the delivered prompt and count
      the bytes above 0x7F in them. Run the gate block intact, then once through each way a hop between the
      product and the executor's shell is known to lose such a byte — dropped, replaced by U+FFFD, truncated at
      the first one — comparing the carried text against the original every time. Detach the worktree HEAD and
      run it again, then sync and run the landing block.
    expected: >
      The branch really is unicode, and the blocks carry zero bytes above 0x7F while still materialising that
      branch and worktree path through printf escapes — so all three lossy carriages leave the text
      byte-identical, reach the same verdict as the intact run, and each still prints REVIEWED_GENERATION_OK.
      (The verdict comparison is token-free on purpose: it measures the carriage, not whether the gate
      announces itself.) The gate has not gone blind for it: a detached HEAD is still refused as 2/symbolic
      with a hex diff, and after the sync the landing block prints LANDING_MERGED for the frozen candidate.
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
