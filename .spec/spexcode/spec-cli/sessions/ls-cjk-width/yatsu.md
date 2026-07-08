---
scenarios:
  - name: cjk-column-alignment
    tags: [cli]
    description: >
      Render the real `formatTable` (the `spex ls` table) with mixed rows — one pure-ASCII label/prompt,
      one CJK label/prompt (e.g. '把最新的 spexcode 装到 macmini 上') — and measure each row with an
      INDEPENDENT display-width function: the cell at which the ID column starts, and whether the NODE
      field was cut mid-glyph or over its 22-cell budget.
    expected: >
      Every row's ID column starts at the same terminal cell (equal display width before it), the NODE
      field never exceeds 22 cells and never ends in a sheared glyph, and a pure-ASCII table is
      byte-identical to the classic padEnd rendering. Zero loss = the table reads as a table in a real
      terminal regardless of script.
    test: spec-cli/src/table-width.test.ts
    code: [spec-cli/src/table-width.test.ts]
    related: [spec-cli/src/sessions.ts]
---

# ls-cjk-width — measurement

YATU: build Session rows through the real `formatTable` export (the exact function `spex ls` prints),
not a re-implementation, and judge alignment with a width function independent of the one under test.
The transcript of that render + per-row cell measurements is the evidence; the unit test file pins the
same contract for CI.
