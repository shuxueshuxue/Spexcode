---
scenarios:
  - name: surgical-backout
    description: >
      Drive one data table over Claude-only and Codex-only disposable Git repositories. Start with tracked
      user prose and ignore rules, run the public `spex init --harness <id>` and `spex materialize`, add a
      user-authored agent intent node, and materialize again. Then make the real derived footprint dirty:
      current and legacy generated skills/agents, a retired `.gitignore` block and skip-worktree bit, current
      and legacy runtime entries, Codex trust, stale plugin bundles named by current/legacy ledgers plus a
      hand-dropped standard-host bundle, and exact/modified/user Git hooks. Run the public `spex uninstall`,
      inspect all non-hook filesystem and Git config surfaces, run it with `--hooks`, then repeat that command.
    expected: >
      Every SpexCode-derived artifact and project-local state entry is gone by ownership identity: managed
      contract/ignore/attribute blocks, shims, generated and name-scoped legacy skills/agents, filter config
      and files, trust entries, plugin bundles from configured/standard/ledger hosts, skip-worktree bits,
      canonical hooks, and the whole per-project store including manifests, stamps, ledgers, sessions, and
      legacy files. User prose, `.gitignore` rules, tracked `.spec` including `.plugins`, `spexcode.json`,
      modified and unrelated hooks, foreign plugins/skills/settings/config, and all other user bytes remain
      identical. Default uninstall leaves all Git hooks, `--hooks` removes only canonical unchanged templates,
      and the repeated `--hooks` uninstall is a clean no-op.
    tags: [cli]
    test:
      path: spec-cli/src/uninstall.test.ts
      name: init → materialize → uninstall forgets every derived artifact for Claude-only and Codex-only repos
    code: spec-cli/src/uninstall.ts
---

# measuring spex-uninstall

YATU through real CLI entrypoints in fresh processes: `spex init`, `spex materialize`, and `spex uninstall`,
against real on-disk Git repositories, never an internal helper. The proof surface is the worktree, Git
common-dir/config, harness global config, and per-project runtime store. `src/uninstall.test.ts` drives the same
lifecycle and assertions for both native rows from one data definition.
