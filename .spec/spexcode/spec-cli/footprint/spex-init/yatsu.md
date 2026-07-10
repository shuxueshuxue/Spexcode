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
  - name: one-step-render-vote
    tags: [cli]
    description: >-
      Run `spex init . --render committed` on a fresh repo, `spex init . --render hidden` on a repo that
      tracks its own CLAUDE.md/AGENTS.md, and `spex init . --render invisible` on a third.
    expected: >-
      committed → spexcode.json carries "render": "committed" and the run's own materialize renders committed
      (render entries out of the ignore block, CLAUDE.md an ordinary file). hidden → the vote lands in
      spexcode.local.json (a host fact; spexcode.json stays untouched) and the block lives in
      .git/info/exclude. The unknown word exits non-zero naming the three-word vocabulary BEFORE anything is
      written — no .spec, no spexcode.json.
  - name: adoption-vote-hint
    tags: [cli]
    description: >-
      Adopt (no --render) on a host repo that already TRACKS its CLAUDE.md/AGENTS.md; then again on a plain
      repo with nothing tracked; then set an explicit "render" and run `spex materialize`.
    expected: >-
      The tracked-host init prints the one-time decision hint — the tracked file named, the three words with
      consequences, the pointer to `spex guide footprint` and `spex init --render` — and the manual
      materialize repeats it while the vote is open. The plain repo prints NO hint, and any explicit render
      (including "ignored" made explicit) retires it. Plain stdout only — never an interactive prompt.
---
# yatsu.md — spex-init

Loss is read through the adoption surface itself (YATU): a throwaway git repo, the real `spex init` /
`spex materialize`, and the CLI's own stdout/exit codes plus git's reports as the reading. What init PRINTS
is part of the product — a message that misstates the planted config is a first-minute lie, so the honest
message is measured, not assumed. Use an isolated SPEXCODE_HOME/CODEX_HOME so a measurement never writes
the real user config. The unit suite in `spec-cli/src/init.test.ts` runs these same loops.
