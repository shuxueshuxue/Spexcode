---
scenarios:
  - name: generated-zcode-stop-runs-gate
    tags: [cli]
    code: spec-cli/hooks/dispatch.sh
    related: [spec-cli/src/harness.ts, spec-cli/src/hook-dispatch.test.ts]
    description: >-
      In a fresh Git repository, run `spex init --harness zcode`, read the generated `.zcode/settings.json`
      Stop command, and invoke that exact command with a Claude-shaped Stop payload for a governed active
      session record in the materialized runtime store.
    expected: >-
      The generated command bakes `zcode` before `Stop`, the current tree's selected manifest retains the
      blocking stop-gate handler, and executing the generated command exits 2 with the gate's block reason.
      The adapter id is consumed as a harness selector, not mistaken for an event name that succeeds without
      running a handler.
  - name: a-non-blocking-handler-failure-is-visible
    tags: [cli]
    description: >-
      Dispatch an event whose manifest lists a NON-blocking handler that writes to stderr and exits non-zero,
      followed by a second non-blocking handler. Read the dispatcher's exit code, its stderr, and its stdout.
    expected: >-
      Exit 0 — a non-blocking handler may not become a gate by failing — while stderr names the event, the
      handler, and the exit code AND carries the handler's own message, and the later handler still runs and
      still contributes its stdout. Zero loss = a lifecycle hook that could not do its job is distinguishable
      from one that ran and declined, which it was not while the exit code was dropped and the captured
      stderr was overwritten by the next handler.
    code: [spec-cli/hooks/dispatch.sh]
    test: spec-cli/src/hook-dispatch.test.ts
---

This scenario measures the generated ZCode hook execution path, distinct from zcode-harness's materialization-only
scenario. It reaches the actual shell command a ZCode installation runs; a handcrafted `dispatch.sh Stop` invocation
would not prove the baked harness argument is parsed.
