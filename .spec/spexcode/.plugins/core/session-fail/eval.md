---
scenarios:
  - name: machine-turn-failure-is-one-active-only-cas
    tags: [backend-api, cli]
    code:
      - .spec/spexcode/.plugins/core/session-fail/fail.sh
      - spec-cli/src/sessions.test.ts
    description: >-
      Against real governed session records, invoke the shipped Claude StopFailure machine entry and the
      generic native/headless failure writer in three states: an undeclared active turn, an already-authored
      declaration, and an explicitly stopped record. Read every result through `spex session show --json`.
    expected: >-
      Every signal source converges on one record-locked compare-and-set. The live undeclared active record
      becomes error; the declaration and explicit stop remain byte-for-byte authoritative. Harness differences
      choose only how a native failure becomes a message and completion time, never whether product lifecycle
      semantics overwrite a non-active record.
  - name: a-real-stopfailure-reaches-the-board-and-a-subagent-never-does
    tags: [backend-api, frontend-e2e]
    description: >-
      Create a live session on an isolated backend and fire a real StopFailure payload through the session
      worktree's OWN materialized shim — the shipped command, not a hand-built one — then read the session
      back over HTTP. Fire it twice: once carrying the payload's top-level `agent_id` (an in-process
      subagent's dead turn) and once without it (the session's own). Read both the record's `lifecycle` and
      the board's reconciled `status`.
    expected: >-
      The subagent payload changes nothing: a helper the session spawned may not mark the session that
      spawned it dead. The session's own failure moves `lifecycle` from `active` to `error`, and the board
      row moves from `working` to `error` with it. Before the failure the pair must read `active`/`working`
      — that gap is the whole point: a dead turn does not exit, its listener keeps answering, so liveness
      stays online and only this chain stops the board painting a stopped agent as running. If materialize
      ever stops writing a tree's own settings there is no shim command to run, and this cannot pass.
    code: [.spec/spexcode/.plugins/core/session-fail/fail.sh]
    test: spec-cli/src/session-fail-chain.yatu.test.ts
---
