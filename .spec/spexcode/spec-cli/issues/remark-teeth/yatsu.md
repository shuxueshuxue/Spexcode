---
scenarios:
  - name: teeth-cli-loop
    tags: [cli]
    code: spec-yatsu/src/freshness.ts
    related: [spec-cli/src/issues.ts, spec-yatsu/src/cli.ts]
    description: >-
      Through the real CLI, on a scenario that already has a passing reading, walk the whole teeth
      lifecycle with no server: `spex remark <node> --scenario <s>`, then `spex yatsu scan`; file a fresh
      `spex yatsu eval --pass` WITHOUT resolving; `spex resolve <ref>` as a SECOND identity; file a fresh
      eval AFTER the resolve; finally author a new remark and `spex retract` it.
    expected: >-
      scan flips the scenario stale on the `remark` axis the moment the remark exists, and it STAYS stale
      through a fresh eval filed before the resolve AND through the resolve itself (the latest reading
      pre-dates resolvedAt). Only a reading filed strictly AFTER the resolve clears it. A brand-new remark
      re-stales it, and a `retract` clears it again with no eval at all. You cannot out-run a remark by
      re-running, nor clear it by passive receipt.
  - name: board-reflects-remark-axis
    tags: [backend-api]
    code: spec-cli/src/board.ts
    related: [spec-yatsu/src/evaltab.ts, spec-cli/src/issues.ts]
    description: >-
      With an unresolved remark on a scenario, hit `GET /api/graph` on a running backend and read the
      node's `evals` entry for that scenario.
    expected: >-
      The reading carries `fresh: false` and `staleAxes: ["remark"]`, and the trunk remark track is
      overlaid onto it as `remarks: [{ rid, ref, by, body, targetCodeSha, resolved:false, dangling }]` —
      the server-side join, with the remark pinned by targetCodeSha or attached to the latest reading
      (`dangling:true`) when the target matches none. The dashboard score ring reads that verbatim; no
      client-side concern-key matching.
---
