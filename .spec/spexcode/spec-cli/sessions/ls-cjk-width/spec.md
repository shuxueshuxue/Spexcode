---
title: ls-cjk-width
status: active
hue: 295
desc: The `spex session ls` table presents the derived TITLE and direct PARENT at terminal display width — CJK/fullwidth glyphs count two cells, so TITLE and PROMPT truncate on cell budget without mid-glyph cuts and every column stays aligned.
code:
  - spec-cli/src/table-width.test.ts
related:
  - spec-cli/src/sessions.ts
---

# ls-cjk-width

## raw source

A CJK-titled session wrecked the `spex session ls` table: the TITLE column was cut with `slice(0, 22)` —
shearing a label mid-word by code units — and padded with `padEnd(22)`, which counts a double-width
glyph as one cell, so every column to the right of a CJK label (or PROMPT) drifted left and the table
stopped reading as a table.

## expanded spec

**Cells, not code units.** The table's unit of alignment is the terminal CELL. `sessions.ts` carries
three width-aware helpers — `displayWidth` (a small wcwidth-style range check over the wide blocks:
CJK ideographs, kana, Hangul, fullwidth forms, emoji — deliberately no dependency), `truncWidth`
(truncate to a cell budget, the ellipsis paying its own cell, never splitting a wide glyph), and
`padWidth` (pad to a cell budget) — and `formatTable`'s TITLE and PROMPT columns (and the NOTE cap)
cut and pad through them. ID and direct PARENT use stable eight-character display cells, so they keep their
structural relationship visible without consuming prompt width. The heading names the current collection and
derives its nonzero status counts from exactly those rows. The TITLE field is the session's shared derived `title`, not its stable
selector `label` or raw `node`: the latter two remain available for matching and JSON consumers but are
not a second visible identity. A pure-ASCII table renders byte-for-byte as the classic `padEnd` output,
so the width fix is invisible until a wide glyph appears.

**Out of scope.** Label *derivation* is untouched — a node-agnostic session falling back to its
prompt-derived title is [[session-label]]'s contract, and this node only owns how any derived string
is fitted into a column. Ambiguous-width code points (e.g. `×`) count one cell, matching common
terminal wcwidth behaviour.
