---
scenarios:
  - name: legacy-tree-loud-refusal
    description: >
      Build a scratch git repo whose spec tree still wears the pre-0.3.0 plugin layout — a root node
      carrying a `.config/` plugin root (with one `surface: system` node) and NO `.plugins/` — and drive
      a real plugin-surface read through the CLI (`spex materialize` is the sharpest: it renders the
      contract block from the gathered system surface). Also drive the inverse skew (a `.plugins`-only
      tree under a loader that reads the other root) to see what silence costs: the contract block
      materializes with ZERO plugin bodies and no error.
    expected: >
      The loader REFUSES loudly: the command exits non-zero with an error naming the v0.3.0 rename
      (`.config` → `.plugins`) and pointing at `spex doctor --migrate`. Silence is the failure mode —
      a run that exits 0 and quietly proceeds (or quietly renders an empty/plugin-less contract) means
      every launched agent runs ungoverned with no signal that the plugins were dropped.
    tags: [cli]
    code: spec-cli/src/specs.ts
---
# measuring plugin-system

Through the real CLI on a disposable git repo — never by reading the loader. The probe surface is
`spex materialize`'s stdout/stderr + exit code, and the rendered `CLAUDE.md` contract block (does the
`surface: system` body actually land?).
