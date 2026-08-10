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
---

This scenario measures the generated ZCode hook execution path, distinct from zcode-harness's materialization-only
scenario. It reaches the actual shell command a ZCode installation runs; a handcrafted `dispatch.sh Stop` invocation
would not prove the baked harness argument is parsed.
