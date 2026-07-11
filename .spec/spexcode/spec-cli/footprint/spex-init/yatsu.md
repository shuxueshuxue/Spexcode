---
scenarios:
  - name: honest-plant-message
    tags: [cli]
    description: >-
      In a fresh git repo, run `spex init .` and compare what the success message + next-steps CLAIM about
      lint.governedRoots with what the planted spexcode.json actually contains.
    expected: >-
      The printed value IS the planted value (the starter ships ["."]), read back from the file — no message
      may restate a config value as a code literal. No stale ["src"] claim anywhere in the output.
  - name: no-vote-adoption
    tags: [cli]
    description: >-
      Adopt on a host repo that already TRACKS its CLAUDE.md/AGENTS.md, through the real `spex init .`
      (the retired --render flag must be gone). Read the output, git status, the index blobs, and the
      host .gitignore.
    expected: >-
      No vote vocabulary anywhere: init covers the tracked contract files with the clean/smudge filter on
      the spot — status clean (no mystery M, no decision hint), index pristine, worktree carries the
      block — and hides wholly-ours artifacts in the per-clone exclude without creating or editing any
      host .gitignore. Plain stdout only — never an interactive prompt.
  - name: retired-field-notice
    tags: [cli]
    description: >-
      Put a legacy `"render"` (any word, including garbage) or `"private": true` in a pre-existing config
      and run `spex init .` / `spex materialize`.
    expected: >-
      Adoption and every materialize still SUCCEED — the field is inert — with a loud, non-fatal stderr notice
      naming the retirement, the removal recipe, and `spex guide footprint`. Removing the field retires
      the notice. Never an exit-nonzero for a retired word.
---
# yatsu.md — spex-init

Loss is read through the adoption surface itself (YATU): a throwaway git repo, the real `spex init` /
`spex materialize`, and the CLI's own stdout/exit codes plus git's reports as the reading. What init PRINTS
is part of the product — a message that misstates the planted config is a first-minute lie, so the honest
message is measured, not assumed. Use an isolated SPEXCODE_HOME/CODEX_HOME so a measurement never writes
the real user config. The unit suite in `spec-cli/src/init.test.ts` runs these same loops.
