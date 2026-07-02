---
scenarios:
  - name: detects-double-delivery
    tags: [cli]
    description: >-
      Drive `spex self conflicts` through the real CLI in a SpexCode-adopted checkout. First run it
      with no plugin bundle present and capture the exit code. Then plant a `spexcode` plugin bundle
      under `.claude/plugins/spexcode/` carrying `.claude-plugin/plugin.json` (`"name":"spexcode"`),
      a `hooks/hooks.json` whose command references `dispatch.sh`, and a `skills/<name>/SKILL.md`
      for one of the materialized skill names — i.e. a second discovery channel alongside the loose
      native delivery. Run `spex self conflicts` again, capture exit code + output, then remove the
      bundle and run once more. File the transcript with
      `spex yatsu eval self --scenario detects-double-delivery --result <txt> --pass`.
    expected: >-
      The first (single-channel) run exits 0 and reports "No double-delivery". With the bundle
      planted the run exits NON-ZERO (1) and flags `claude` as DOUBLE-DELIVERY CONFLICT on every
      channel it stamps: delivery sources 2 (loose + the named plugin), hooks→dispatch 2, and the
      skill name shadowed ×2 — codex (no codex bundle) stays single/ok — followed by the three
      repair options (remove the bundle / switch `harnesses` to a plugin target / uninstall the
      loose copy). After the bundle is removed the run returns to exit 0. Detection is purely by
      identity stamp (plugin.json name, the dispatch.sh shim, our skill names), never payload.
    code: spec-cli/src/self.ts
---
# yatsu.md — self

`self`'s double-delivery check is measured through the real `spex self conflicts` CLI (YATU): the agent
plants a genuine second discovery channel — a `spexcode` plugin bundle beside the loose native delivery —
and confirms the command catches it by IDENTITY STAMP and exits non-zero, then that removing the bundle
clears it. The loss being watched is the SILENT double-delivery: a marketplace-installed or leftover
`spexcode` plugin doubling hooks and shadowing skills while everything still *looks* governed — the
mirror failure of the under-delivery `doctor` already catches.
