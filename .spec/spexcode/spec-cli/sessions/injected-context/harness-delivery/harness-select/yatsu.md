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
  - name: default-delivers-every-native
    tags: [cli]
    description: >-
      In a fresh project with NO `harnesses` field, run `spex materialize` and inspect what landed.
    expected: >-
      Both native harnesses are delivered — Claude's CLAUDE.md <spexcode> block + .claude/settings.json shim,
      and Codex's AGENTS.md block + .codex/hooks.json shim (at the main checkout). Omitting the field means
      "every native harness", never nothing.
  - name: deselect-prunes-the-dropped-harness
    tags: [cli]
    description: >-
      Materialize with the default set, confirm codex artifacts exist, then set `harnesses` to ["claude"] and
      re-materialize. Inspect codex's and claude's artifacts and any user prose in AGENTS.md.
    expected: >-
      Codex's products are PRUNED — its AGENTS.md <spexcode> block stripped, its .codex/hooks.json shim and
      .codex/skills removed, its global trust block gone — while Claude's artifacts stay intact. Any user prose
      outside the AGENTS.md managed block is preserved; no .spec data is touched.
---
# yatsu.md — harness-select

Loss is read through the CLI surface a real adopter touches (YATU): `spex materialize` / `spex init` on a
project whose spexcode.json carries a `harnesses` set. Two things must hold: an ILLEGAL set fails loud with an
intelligible reason (never a silent or partial delivery), and NARROWING the set prunes exactly the dropped
harness's own artifacts — surgically, leaving the user's prose and `.spec` untouched. Use an isolated
SPEXCODE_HOME/CODEX_HOME so a measurement never writes the real user config.
