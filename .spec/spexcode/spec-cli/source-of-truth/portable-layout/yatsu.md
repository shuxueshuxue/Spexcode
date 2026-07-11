---
scenarios:
  - name: committed-plus-local-overlay
    description: >
      Through a real CLI verb (never by reading layout.ts): in a throwaway git repo, (1) run with NO
      config — `spex internal trunk` must auto-detect the checkout's actual branch; (2) commit a
      spexcode.json with `mainBranch` naming a different existing branch — the verb must follow the
      committed override; (3) add a gitignored spexcode.local.json overriding the same field — the
      host-local layer must win; (4) make one of the files malformed JSON and re-run.
    expected: >
      Resolution follows the documented precedence exactly — local overlay > committed spexcode.json >
      auto-detect. A PRESENT-but-malformed config splits by surface, both honestly: a config-consuming
      verb (spex materialize) fails LOUD naming the file and the parse error (exit non-zero — never a
      silent fall-through that drops every tuned setting), while the trunk-resolution plumbing verb
      DEGRADES to auto-detect by design (the pre-commit hook rides it and must never die on a config
      typo; its own pure-git fallback assumes exactly this resilience).
    tags: [cli]
    code: spec-cli/src/layout.ts
---

Measured through the CLI seam that resolves layout for every other verb (`spex internal trunk` =
layout.ts mainBranch()), in a throwaway repo with an isolated SPEXCODE_HOME. The reading is the verb's
stdout/exit per config state; file the transcript with `--result`.
