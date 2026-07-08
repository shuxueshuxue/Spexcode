---
title: ls-cjk-width
status: active
hue: 295
desc: The `spex ls` table aligns by terminal display width — CJK/fullwidth glyphs count two cells, so NODE and PROMPT truncate on cell budget without mid-glyph cuts and every column stays aligned.
code:
  - spec-cli/src/table-width.test.ts
related:
  - spec-cli/src/sessions.ts
---

# ls-cjk-width

## raw source

A CJK-titled session wrecked the `spex ls` table: the NODE column was cut with `slice(0, 22)` —
shearing a label mid-word by code units — and padded with `padEnd(22)`, which counts a double-width
glyph as one cell, so every column to the right of a CJK label (or PROMPT) drifted left and the table
stopped reading as a table.

## expanded spec

**Cells, not code units.** The table's unit of alignment is the terminal CELL. `sessions.ts` carries
three width-aware helpers — `displayWidth` (a small wcwidth-style range check over the wide blocks:
CJK ideographs, kana, Hangul, fullwidth forms, emoji — deliberately no dependency), `truncWidth`
(truncate to a cell budget, the ellipsis paying its own cell, never splitting a wide glyph), and
`padWidth` (pad to a cell budget) — and `formatTable`'s NODE and PROMPT columns (and the NOTE cap)
cut and pad through them. A pure-ASCII table renders byte-for-byte as the classic `padEnd` output, so
the fix is invisible until a wide glyph appears.

**Out of scope.** Label *derivation* is untouched — a node-agnostic session falling back to its
prompt-derived title is [[session-label]]'s contract, and this node only owns how any derived string
is fitted into a column. Ambiguous-width code points (e.g. `×`) count one cell, matching common
terminal wcwidth behaviour.
