---
scenarios:
  - name: a-governed-write-spends-the-gate
    tags: [cli]
    test: spec-cli/src/hook-dispatch.test.ts
    code: .spec/spexcode/.plugins/core/spec-first/spec-first.sh
    description: >-
      Adopt an empty repository the way a new user does — `spex init --harness claude` — govern one source
      file with a `code:` claim, then fire the materialized PreToolUse shim with a Write against that file,
      and again with the same Write.
    expected: >-
      The first Write blocks once and names the resolved governing spec by path and id. The retry passes, so
      the gate is one-shot. This is the half of the trigger that has been dropped twice: a session whose first
      governed touch is a write must not sail past, because the rule it enforces is read the contract first
      and a blind write is its strongest case.
---
# measuring spec-first

The gate is measured through the adoption path, not through the handler alone: `spex init` materializes the
shim, the shim dispatches the hook, and the hook asks the real spec graph for a governor. A unit test that
called the handler directly would keep passing while materialization, dispatch, or the governor lookup broke.
