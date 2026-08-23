---
title: typography
status: active
hue: 218
desc: The dashboard's visual vocabulary — two font roles with one of them swappable (the UI font, mono by default), a restrained type scale, three weights, a three-tone ground ladder, and one geometry token set every rule spends instead of hand-writing.
code:
  - spec-dashboard/src/styles.test.mjs
related:
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/terminalFont.js
---
# typography

The vocabulary every surface speaks in. Not a style guide beside the code — a token set in `:root` and a
gate that fails the build when a rule spends something outside it.

**Hierarchy escalates space → colour → weight → size, in that order.** Reach for the cheapest signal that
works and stop there. This ordering is why the scale below can be short, why three weights are enough, and
why an all-caps tracked label is not a level: shape is not on the ladder, so a label that shouts is
decoration wearing hierarchy's costume. Chrome labels are sentence case, and the sheet contains no
`text-transform: uppercase` and no letter-spacing but zero.

## two roles, one of them swappable

Two tokens, and the split between them is by **role**, not by taste.

`--mono` is fixed. It is what the machine speaks in, and it is not negotiable:

- code and terminal output;
- machine identifiers — ids, paths, hashes, keycaps;
- a query DSL, where the input and its highlight overlay must align glyph for glyph;
- columns that must line up (timecodes, tabular numbers).

`--ui-font` is everything a person parses as **language**: chrome, controls, labels, prose, empty states.
It is the one token in the vocabulary a reader may retune, and it can be retuned only because every
language surface spends the token instead of naming a family — 116 declarations, one line to flip.

**Today `--ui-font` resolves to `var(--mono)`, and that is the default on purpose.** The board was
converted to a sans stack and the owner judged the result uglier than what it replaced: the terminal
voice is what the product is supposed to feel like, and numbers and the `Running`/node labels are where
the loss showed worst. So the default went back. `--ui-font-sans` keeps the sans stack declared and
ready — it is the value a per-user **Settings** toggle will offer, not a stack in use.

Both are system stacks; no webfont is fetched, so the vocabulary costs nothing to load and degrades to
whatever the reader's platform has.

**The machinery is the point, and it survives either default.** Before it, forty-odd components each
hand-wrote a family, so "what font is the product" was not a question the sheet could answer, let alone
change. Routing every language site through one token made the whole board's voice a single decision —
which is what let it be converted to sans, what let it be converted straight back when the owner looked
at it, and what will let a reader choose for themselves. A surface that hand-writes a family, or reaches
for `--mono` directly for something that is language, takes itself out of that decision and out of the
toggle's reach.

## the scale

Body is 13px and does it does the work. A page may spend `--type-display` **once**, on its own statement —
its title, or a launch surface's wordmark — and then not again. The rest of the ladder exists to say
"smaller than body" (`--type-meta`, `--type-caption`) or "a heading" (`--type-subtitle`, `--type-title`,
`--type-heading`), and a control's label is body text because a control's label is language.

Three weights: regular, medium, semibold. A fourth is a fourth way to say "important" competing with the
three that already work, so there is no bold and no black — the gate asserts the sheet uses exactly these
three and names no others.

Every `font-size`, `font-weight`, `line-height` and `letter-spacing` in the sheet is a token reference. A
literal is a value nobody can re-tune; the guard that rejects one is what kept the status bar's own height
from becoming a number encoded inside an unrelated component ([[status-bar]]).

## the ground ladder

Three tones, deepest to brightest:

- **`--ground`** — the chrome floor: the rail, the finding dock, the status bar, the context dock.
- **`--panel`** — between: the tab strip, toolbars, cards laid on paper.
- **`--paper`** — the one content plane, brightest, and the only tone a document is drawn on.

**The active tab is painted `--paper`**, so the tab and its document read as one plane rather than as a lit
chip on a bar. That continuity is the whole reason the ladder has three steps: the reader should be able to
see where the document is without a border telling them. The previous two-tone frame differed by five
values out of 255 — a 1.07:1 contrast, which is not a step, and it is why every boundary in the window had
to be drawn as a line.

With real ground steps doing the separating, a chrome boundary is **felt, not seen**: `--edge` is a
half-strength `--line`, and it is what the rail, dock, strip, status bar and context dock are bounded with.
`--line` remains the honest divider for a card, a field, a table rule — the places a real edge is the point.

`--divider-rule` is the one quiet rule for seams and group heads: `1px solid var(--edge)`. A caller may
place that rule on a border or use it as the trailing hairline of a heading, but it does not invent another
colour or weight for the same boundary job. The tab strip's content boundary is owned by the content host's
top edge, so the active tab and document meet through the same token without a second strip line.

**A SEAM IS A STEP, NOT A LINE — and the step is built from the ladder itself.** Where the chrome floor
meets the content plane the boundary runs `--ground` · the `--edge` hairline · one pixel of `--panel` ·
`--paper`: four values in three pixels. That middle pixel is what makes the document read as sitting ABOVE
the chrome rather than beside it, and it is the same rung the tab strip is painted in, so it continues
unbroken across the top of the content column and then down its leading edge. This is the whole of the
"raised panel" feel that other editors buy with a drop shadow, and it is why we do not have to:

**One elevation, and depth is not one of its jobs.** `--shadow` is a single drop spent only on things that
genuinely float. Stacking shadows to fake a surface is the failure mode this rule exists to prevent — a
window whose panels each cast their own is a window where nothing reads as a plane and everything reads as
a sticker. A surface earns its depth from the ladder; only a thing that leaves the plane pays the shadow.

**The dark terminal is a card on the plane, not a wall against the seam.** It keeps its own `--term-bg` —
the one surface that is legitimately dark in every theme — and a small `--paper` gutter runs down its
leading edge so the plane it sits on is visible beside it. Leading edge only: its other three sides already
meet chrome that steps for them.

All seven theme presets plus the default carry all three tones as resolved values; `--ground` is each
theme's own deepest surface where its palette has one, and a derived step below `--panel` where it does not.
A theme that resolved only two of the three would silently collapse the ladder for its readers.

## geometry

`--radius` (6px) is the corner of every box that is not a circle, `--radius-full` the pill. A circle is a
shape, not a step on a radius scale, so `50%` stays literal — and so do the one- and two-pixel marks, which
are ticks rather than boxes. Everything else spends the token: sixty-nine hand-written radii across the
sheet were sixty-nine numbers nobody could re-tune together.

`--space-1` … `--space-7` is the spacing ladder new rules spend. Existing padding is not churned for its own
sake; a rule being edited moves onto the ladder as it is touched.

**One elevation.** `--shadow` is the single drop, and only genuinely floating things spend it — pop-overs,
menus, the floating composer. Everything else sits flat on its ground. Rings drawn as `box-shadow`
(a focus outline, the avatar's liveness ring) are borders, not elevation, and are not this token's business.
Before it there were a dozen hand-rolled drops between 8px and 64px of blur, three of them in raw `rgba`
the themes could not re-skin — a dozen different ideas of "above" on one screen.

## the gate

`styles.test.mjs` is this body in executable form: it asserts both role tokens exist, that `--ui-font`
defaults to the mono stack and `--ui-font-sans` stays declared for the future setting, that every
`font-family` in the sheet names a role token rather than a family and that both roles are still spent
(collapsing language onto `--mono` would weld the board to one family and leave the toggle nothing to
flip), that no all-caps or tracked label survives, that exactly three
weight tokens are in use, that the radius and elevation tokens own their properties, that all eight palettes
resolve the full ground ladder and the chrome surfaces spend it — and that the chrome rows
[[ui-state-model]]'s budget refused stay retired at the source. It runs with the unit suite, off the sheet's
text, so a rule that drifts from this vocabulary fails before a browser is involved.
