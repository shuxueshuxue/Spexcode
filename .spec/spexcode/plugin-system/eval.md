---
scenarios:
  - name: legacy-tree-loud-refusal
    description: >
      Build a scratch git repo whose spec tree still wears the pre-0.3.0 plugin layout — a root node
      carrying a `.config/` plugin root (with one `surface: system` node) and NO `.plugins/` — and drive
      a real plugin-surface read through the CLI (`spex materialize` is the sharpest: it renders the
      contract block from the gathered system surface). Also drive the inverse skew (a `.plugins`-only
      tree under a loader that reads the other root) to see what silence costs: the contract block
      materializes with ZERO plugin bodies and no error. Invoke the repair spelling with the current CLI too.
    expected: >
      The loader REFUSES loudly: the command exits non-zero with an error naming the v0.3.0 rename
      (`.config` → `.plugins`) and pointing at `spex doctor --migrate`. That spelling exits 2 without
      writing and explains that a 0.2.x tree must pass through a 0.3.x SpexCode release before using the
      current release; the current CLI exposes no permanent migrator. Silence is the failure mode —
      a run that exits 0 and quietly proceeds (or quietly renders an empty/plugin-less contract) means
      every launched agent runs ungoverned with no signal that the plugins were dropped.
    tags: [cli]
    code: spec-cli/src/specs.ts
  - name: core-flat-topology
    description: >
      Verify `core` sits as a DIRECT `.plugins` child — a peer of the `prompts` shelf, never a resident —
      and that its position is invisible to every gathered surface. Probe the real product, not the loader:
      (1) the live tree and the init template both carry `.plugins/core/spec.md` (with its `surface: hook`
      children) and NO `.plugins/prompts/core/`; (2) `spex materialize` renders the contract block with
      core's body gathered exactly as any other `surface: system` plugin (the field, not the path, routes);
      (3) a fresh `spex init` on a scratch git repo seeds the same flat-core shape and its contract block
      carries the core disciplines.
    expected: >
      Both trees and a fresh init show core flat beside the prompts shelf (prompts holds only the auxiliary
      single-body system contracts); the materialized contract block is unchanged by the node's position
      (a pure move diffs to nothing). No release-migration table participates in the current gather path.
    tags: [cli]
    code: spec-cli/src/specs.ts
---
# measuring plugin-system

Through the real CLI on a disposable git repo — never by reading the loader. The probe surface is
`spex materialize`'s stdout/stderr + exit code, and the rendered `CLAUDE.md` contract block (does the
`surface: system` body actually land?).
