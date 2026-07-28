---
scenarios:
  - name: committed-plus-local-overlay
    description: >
      Through real CLI verbs (never by reading layout.ts), initialize a throwaway repo whose root checkout is
      on `staging`; `spex init` must stamp that branch. Then use ordinary `git switch` to check out `node/x`
      in the same directory and also create a linked worktree. Read `spex internal trunk` from both; add a
      gitignored spexcode.local.json override, then make one config file malformed and re-run.
    expected: >
      Both checkout methods keep naming `staging`; the ordinary switch never redefines `node/x` as trunk.
      Resolution follows local overlay > committed spexcode.json > conventional `main`. A present malformed
      file fails LOUD naming the file and parse error; it never silently drops the stable branch fact.
    tags: [cli]
    code:
      - spec-cli/src/layout.ts#mainBranch
      - spec-cli/src/layout.ts#readConfig
---

Measured through the CLI seam that resolves layout for every other verb (`spex internal trunk` =
layout.ts mainBranch()), in a throwaway repo with an isolated SPEXCODE_HOME. The reading is the verb's
stdout/exit per config state; file the transcript with `--result`.
