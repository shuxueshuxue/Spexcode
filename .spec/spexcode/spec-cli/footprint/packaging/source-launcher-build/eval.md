---
scenarios:
  - name: clean-source-launcher-builds-runtime-closure
    tags: [cli]
    description: >
      Construct a source-shaped workspace with its CLI/core/session-core/eval/forge dist directories absent, then invoke
      the real CLI launcher.
    expected: >
      The launcher imports a fresh complete closure or invokes the workspace build once, all required compiled
      entries exist, and the compiled CLI handles the requested command. An installed package does not take
      this source-workspace build path.
    test:
      path: spec-cli/src/launcher-tsx.test.ts
      name: a source workspace launcher builds its missing runtime closure before it invokes it
    code: spec-cli/src/launcher-tsx.test.ts

  - name: concurrent-source-launchers-single-flight-build
    tags: [cli]
    description: >
      Start two source-workspace launchers while the runtime closure is absent.
    expected: >
      Exactly one workspace build runs; both launcher processes execute the resulting compiled CLI.
    test:
      path: spec-cli/src/launcher-tsx.test.ts
      name: concurrent source launchers single-flight the workspace build
    code: spec-cli/src/launcher-tsx.test.ts

  - name: ordered-build-driver-avoids-npm-workspace-spawns
    tags: [cli]
    description: >
      On a fresh source worktree, time the real launcher with no dist, the root build, each of the ten
      workspace builds through npm, and the same ten atomic builds through the root driver's direct Node
      boundary. Repeat the pair under the same box load and record real, user, and sys time.
    expected: >
      A clean worktree imports main's fresh complete closure and rebuilds only changed packages plus dependents.
      A changed source, missing main artifact, or stale main artifact falls back to the ordered ten-package
      driver. A project-reference graph is not introduced because the ten TypeScript compiles, rather than npm
      setup, dominate the measured CPU time.
    code:
      - package.json
      - scripts/build-workspaces.mjs
---

# source launcher build loss

The failure appeared at the actual landing boundary: the prepared reference hook invokes the source launcher
from a clean main checkout, where `dist/cli.js` does not exist. This scenario drives that exact launcher shape
without pre-created artifacts, so it proves the hook's entry can recover before its candidate lint runs.

The cold worktree measurement on this box (Node 24.15.0, 2026-08-29) found the root build at 16.28s real,
30.50s user, and 2.99s sys under the observed concurrent load; individual npm workspace builds were 0.88-1.18s
real and 1.54-2.12s user, while direct `build-dist.mjs` calls were 0.68-1.97s real for the same packages. The
waiting shape was the repeated full compilation of an identical fresh-worktree source closure, not a
history-sized lint walk. The attempted direct driver measured 15.06s real, 30.02s user, and 2.61s sys versus
16.28s, 30.50s, and 2.99s for the npm root build under the same load, so removing npm wrappers alone was not
material. A project-reference graph would require composite config changes and a new artifact policy; the
chosen main-closure import plus selective rebuild spends a source fingerprint and dependency map to remove all
ten compiles on the cold path and only rebuild the changed closure after a comment edit.
