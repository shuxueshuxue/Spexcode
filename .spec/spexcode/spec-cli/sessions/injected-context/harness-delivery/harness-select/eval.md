---
scenarios:
  - name: illegal-harness-set-fails-loud
    tags: [cli]
    description: >-
      In a fresh git project, set spexcode.json `harnesses` to an illegal value and run `spex materialize`:
      first ["claude", {"plugin": ".zcode"}] (plugin + native), then ["plugin"] (plugin, no folder).
    expected: >-
      Each run exits NON-ZERO with a clear reason — the first names plugin EXCLUSIVITY (a plugin cannot coexist
      with native harnesses), the second says a plugin target needs an explicit landing folder. No artifact is
      written for the bad set; the failure is loud, never a silent or partial delivery.
  - name: missing-selection-fails-loud
    tags: [cli]
    description: >-
      In a fresh git project, run `spex init` with NO --harness flag and no `harnesses` field; then, in an
      adopted project, delete the `harnesses` field from spexcode.json and run `spex materialize`.
    expected: >-
      Both fail loud, non-zero: init aborts BEFORE writing anything (no .spec, no spexcode.json) with an
      error naming `--harness` and the known ids; materialize aborts naming the missing field and the
      `spex init --harness` stamp as the repair. There is no default set — nothing is silently delivered.
  - name: init-stamps-the-choice
    tags: [cli]
    description: >-
      Run `spex init --harness codex` in a fresh git project and inspect the planted spexcode.json and tree.
    expected: >-
      spexcode.json carries "harnesses": ["codex"] and ONLY a codex launcher (defaultLauncher "codex");
      codex artifacts exist (.codex/hooks.json, AGENTS.md block) and NO claude artifact does — the unselected
      harness leaves zero litter.
  - name: deselect-prunes-the-dropped-harness
    tags: [cli]
    description: >-
      Materialize with `harnesses` ["claude","codex"], confirm codex artifacts exist, then set `harnesses` to
      ["claude"] and re-materialize. Inspect codex's and claude's artifacts and any user prose in AGENTS.md.
    expected: >-
      Codex's tree-local products are PRUNED — its AGENTS.md <spexcode> block and .codex/skills disappear —
      while Claude's artifacts stay intact. Project-scoped .codex/hooks.json and trust may remain installed,
      but the tree's final allowlist omits codex and a real codex dispatch is a no-op. Any user prose outside
      the AGENTS.md managed block is preserved; no .spec data is touched.
  - name: selection-edit-self-heals
    tags: [cli]
    description: >-
      Adopt with `harnesses` ["claude","codex"] (both natives delivered), then narrow spexcode.json `harnesses` to
      ["codex"]. First fire a harness lifecycle event through dispatch.sh (must materialize NOTHING — the
      dispatcher is not a trigger), then bring the edit to a git-native anchor ([[commit-surgery]]): the
      pre-commit hook's unconditional materialize, or `spex materialize`. Inspect the .claude artifacts.
    expected: >-
      The harness event leaves everything byte-unchanged. The anchor materialize then prunes claude's artifacts
      (.claude gone, the generated CLAUDE.md gone / block stripped) under the narrowed set. A selection change
      self-heals at the next git transition — never via a harness event, never waiting for an unrelated
      .plugins edit.
  - name: checkout-method-independent-selection
    tags: [cli]
    code:
      - spec-cli/src/materialize.ts#materialize
      - spec-cli/src/contract-filter.ts
      - spec-cli/hooks/dispatch.sh
    description: >-
      Put a codex-only spexcode.json on a candidate commit while main carries a different valid selection.
      Judge that same candidate first by switching the root checkout to it, then by restoring main and adding
      the candidate as a linked worktree. Materialize both registered trees in alternating order; inspect each
      tree's contract/filter/ignore output, the shared Codex shim/trust, and dispatch from an unselected tree.
    expected: >-
      Checkout method changes nothing: the candidate reads its own codex selection and materializes
      successfully in both shapes. Each tree keeps only its selected local artifacts and its own filter payload;
      a later sibling materialize cannot rewrite them. Project-scoped Codex transport survives a sibling
      materialize, while the final per-tree allowlist makes dispatch in an unselected tree a no-op. Git
      status/index keep host prose honest and no user global ignore configuration is replaced.
---
# eval.md — harness-select

Loss is read through the CLI surface a real adopter touches (YATU): `spex materialize` / `spex init` on a
project whose spexcode.json carries a `harnesses` set. Two things must hold: an ILLEGAL set fails loud with an
intelligible reason (never a silent or partial delivery), and NARROWING the set prunes exactly the dropped
harness's own artifacts — surgically, leaving the user's prose and `.spec` untouched. Use an isolated
SPEXCODE_HOME/CODEX_HOME so a measurement never writes the real user config.
