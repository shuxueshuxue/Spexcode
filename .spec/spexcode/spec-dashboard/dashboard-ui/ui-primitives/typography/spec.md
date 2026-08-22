---
title: typography
status: active
hue: 218
desc: The dashboard's visual vocabulary — two font families with one rule between them, a restrained type scale, three weights, a three-tone ground ladder, and one geometry token set every rule spends instead of hand-writing.
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

## two families, one rule

`--sans` is the product's voice: chrome, controls, labels, prose — every word a person parses as language.
`--mono` is reserved for the four things that are **not** language:

- code and terminal output;
- machine identifiers — ids, paths, hashes, keycaps;
- a query DSL, where the input and its highlight overlay must align glyph for glyph;
- columns that must line up (timecodes, tabular numbers).

Both are system stacks; no webfont is fetched, so the vocabulary costs nothing to load and degrades to
whatever the reader's platform has. The document defaults to `--sans`, so a surface reaching for mono is
making a claim, and the gate holds mono to a minority of all family declarations. A surface that reaches
for mono without one of those four reasons is reaching for a costume.

**This is the correction of a real failure.** The board was mono end to end — one family across forty-odd
components, chrome included — which read as a terminal emulator wearing a product's chrome rather than as a
product. Mono is a signal; a signal spent everywhere signals nothing, and it costs the same reader the
legibility of every label that was never code. The split gives the signal back its meaning.

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

`styles.test.mjs` is this body in executable form: it asserts both family tokens exist, that the document
defaults to sans and mono stays the minority, that no all-caps or tracked label survives, that exactly three
weight tokens are in use, that the radius and elevation tokens own their properties, that all eight palettes
resolve the full ground ladder and the chrome surfaces spend it — and that the chrome rows
[[ui-state-model]]'s budget refused stay retired at the source. It runs with the unit suite, off the sheet's
text, so a rule that drifts from this vocabulary fails before a browser is involved.
