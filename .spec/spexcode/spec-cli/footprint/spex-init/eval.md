---
scenarios:
  - name: honest-plant-message
    tags: [cli]
    description: >-
      In a fresh git repo, run `spex init . --harness claude,codex` and compare what the success message +
      next-steps CLAIM about lint.governedRoots, harnesses, and launchers with what the planted
      spexcode.json actually contains.
    expected: >-
      Every printed value IS the planted value (the starter ships governedRoots ["."]; harnesses and the
      seeded launcher names echo the --harness choice), read back from the file — no message may restate a
      config value as a code literal. No stale ["src"] claim anywhere in the output.
  - name: no-vote-adoption
    tags: [cli]
    description: >-
      Adopt on a host repo that already TRACKS its CLAUDE.md/AGENTS.md, through the real
      `spex init . --harness claude,codex` (the retired --render flag must be gone). Read the output,
      git status, the index blobs, and the host .gitignore.
    expected: >-
      No vote vocabulary anywhere: init covers the tracked contract files with the clean/smudge filter on
      the spot — status clean (no mystery M, no decision hint), index pristine, worktree carries the
      block — and hides wholly-ours artifacts in the per-clone exclude without creating or editing any
      host .gitignore. Plain stdout only — never an interactive prompt.
  - name: retired-field-notice
    tags: [cli]
    description: >-
      Put a legacy `"render"` (any word, including garbage) or `"private": true` in a pre-existing config
      and run `spex init . --harness claude,codex` / `spex materialize`.
    expected: >-
      Adoption and every materialize still SUCCEED — the field is inert — with a loud, non-fatal stderr notice
      naming the retirement, the removal recipe, and `spex guide footprint`. Removing the field retires
      the notice. Never an exit-nonzero for a retired word.
  - name: selected-harness-artifact-report
    tags: [cli]
    test: spec-cli/src/init.test.ts
    description: >-
      In separate fresh git repos with isolated SPEXCODE_HOME/CODEX_HOME, run the real `spex init` once with
      `--harness claude` and once with `--harness codex`. Compare each materialized-artifact receipt with the
      contract, shim, and global trust files that actually landed, and read the planted project spec.
    expected: >-
      Claude-only reports and plants CLAUDE.md plus the Claude shim, with no AGENTS.md, Codex shim, or trust
      claim/file. Codex-only reports and plants AGENTS.md, the Codex shim, and scoped Codex trust, with no
      CLAUDE.md or Claude shim claim/file. The starter project spec describes the initialized system, hook,
      command, and skill surfaces without the obsolete claim that the seed consists only of core plus tidy.
---
# eval.md — spex-init

Loss is read through the adoption surface itself (YATU): a throwaway git repo, the real `spex init` /
`spex materialize`, and the CLI's own stdout/exit codes plus git's reports as the reading. What init PRINTS
is part of the product — a message that misstates the planted config is a first-minute lie, so the honest
message is measured, not assumed. Use an isolated SPEXCODE_HOME/CODEX_HOME so a measurement never writes
the real user config. The unit suite in `spec-cli/src/init.test.ts` runs these same loops.
