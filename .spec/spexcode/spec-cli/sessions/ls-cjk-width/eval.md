---
scenarios:
  - name: cjk-column-alignment
    tags: [cli]
    description: >
      Render the real `formatTable` (the `spex session ls` table) with mixed rows — one pure-ASCII label/prompt,
      one CJK label/prompt (e.g. '把最新的 spexcode 装到 macmini 上') — and measure each row with an
      INDEPENDENT display-width function: the cell at which the ID column starts, and whether the TITLE
      field was cut mid-glyph or over its 22-cell budget.
    expected: >
      Every row's ID column starts at the same terminal cell (equal display width before it), the TITLE
      field never exceeds 22 cells and never ends in a sheared glyph, and a pure-ASCII table is
      byte-identical to the classic padEnd rendering. Zero loss = the table reads as a table in a real
      terminal regardless of script.
    test: spec-cli/src/table-width.test.ts
    code: [spec-cli/src/table-width.test.ts]
    related: [spec-cli/src/sessions.ts]
  - name: title-column-is-derived-title
    tags: [cli]
    description: >
      Run the real `spex session ls` against a session whose stable `label` differs from its visible
      derived `title`, such as a node-bound session with current live activity. Read the table header and
      the row while also reading its `--json` projection.
    expected: >
      The human table header is TITLE and its 22-cell field displays the same derived `title` as the JSON
      projection, never the selector `label` or raw `node`. The JSON `node` field remains intact for
      selectors and machine consumers. Zero loss = a human does not mistake a legacy node handle for the
      session's current title.
    test: spec-cli/src/table-width.test.ts
    code: [spec-cli/src/sessions.ts, spec-cli/src/table-width.test.ts]
---

# ls-cjk-width — measurement

YATU: build Session rows through the real `formatTable` export (the exact function `spex session ls` prints),
not a re-implementation, and judge alignment with a width function independent of the one under test.
The transcript of that render + per-row cell measurements is the evidence; the unit test file pins the
same contract for CI.

The title-column scenario is measured through a real `spex session ls` process and its `--json` projection:
the transcript compares the rendered TITLE field against the derived wire title while retaining the raw node
as machine-visible evidence.
