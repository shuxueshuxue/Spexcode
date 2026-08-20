---
scenarios:
  - name: clean-source-launcher-builds-runtime-closure
    tags: [cli]
    description: >
      Construct a source-shaped workspace with its CLI/core/session-core/eval/forge dist directories absent, then invoke
      the real CLI launcher.
    expected: >
      The launcher invokes the workspace build once, all five compiled entries exist, and the compiled CLI
      handles the requested command. An installed package does not take this source-workspace build path.
    test:
      path: spec-cli/src/launcher-tsx.test.ts
      name: a source workspace launcher builds its missing runtime closure before it invokes it
    code: spec-cli/src/launcher-tsx.test.ts
---

# source launcher build loss

The failure appeared at the actual landing boundary: the prepared reference hook invokes the source launcher
from a clean main checkout, where `dist/cli.js` does not exist. This scenario drives that exact launcher shape
without pre-created artifacts, so it proves the hook's entry can recover before its candidate lint runs.
