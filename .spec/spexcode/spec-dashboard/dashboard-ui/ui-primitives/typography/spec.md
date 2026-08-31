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

**`--ui-font` resolves to `var(--mono)` by default, and that default is on purpose.** The board was
once converted wholesale to a sans stack and the owner judged the result uglier than what it replaced:
the terminal voice is what the product is supposed to feel like, and numbers and the `Running`/node
labels are where the loss showed worst. So the default went back. **The voice is a preset's to choose.**
`--ui-font-sans` is the declared sans stack, and a theme row may resolve `--ui-font` to it — the Notion
preset does, because a Notion-feel board is a sans board — while every other preset inherits the mono
default. Choosing a theme is therefore also choosing a voice; no separate font setting exists.

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

Four rungs, deepest to brightest, plus one surface that is not on the ladder at all:

- **`--term-bg`** — the well: the embedded terminal, and the floor of the window. Not a rung (below).
- **`--ground`** — the chrome floor: the rail, the finding dock, the status bar, the context dock.
- **`--panel`** — between: the tab strip, toolbars, the session list, cards laid on paper.
- **`--paper`** — the one content plane, and the only tone a document is drawn on.
- **`--raised`** — the only rung ABOVE the plane: every menu, pop-over, tooltip, notice, and floating
  composer. Brightest.

**The active tab is painted `--paper`**, so the tab and its document read as one plane rather than as a lit
chip on a bar. That continuity is the whole reason the ladder has steps at all: the reader should be able to
see where the document is without a border telling them. The previous two-tone frame differed by five
values out of 255 — a 1.07:1 contrast, which is not a step, and it is why every boundary in the window had
to be drawn as a line.

**THE LADDER RUNS ONE WAY, AND THE WAY IS PHYSICAL.** Light falls from above, so a surface that is higher
catches more of it and is lighter. That is not a house style; it is what every system that has thought about
it concluded independently — Material 3's dark surface containers climb T4 → T22 with elevation, and IBM
Carbon states outright that in dark themes "layers become one step lighter with each added layer". Both fall
back to the **shadow** in light themes, and for the same reason: a light plane is already at the top of the
range, so there is no headroom left to climb, while a drop that reads as nothing on a near-black ground reads
perfectly well on a white one. So `--raised` is never darker than `--paper`. In a dark preset it is a real
step up and the drop is nearly inert; in a light preset it sits at the plane and the drop does the work.

**A step is a measurement, and it is two different measurements.** The unit is CIE L\*, perceptual
lightness — never a WCAG contrast ratio, which compresses to nothing at the dark end and scores a broken ramp
and a good one at the same 1.1:1. A flat-field lightness JND is about 1 L\*, and:

- a **region** step — a different part of the same window, side by side — is **≥ 4 L\***. VS Code Dark
  Modern's sidebar-to-editor is 3.5; Material 3's surface to surfaceContainerLow is 4.
- an **elevation** step — this surface has left the plane — is **≥ 6 L\***. Carbon's dark layers step 8–11,
  Material 3's dark surface containers 5–6, VS Code's editor-to-dropdown 8.6.

A menu makes the second claim, so it pays the second price. This is the rule the sheet broke for a long time:
every floating surface was painted `--panel`, a rung **below** the plane it floats over, which reads as a hole
punched in the window rather than a card lifted off it — and `--panel` was also, in five of the nine presets,
the exact value of `--term-bg`. A right-click over the terminal therefore opened a menu whose ground was
**identical** to the ground beneath it (ΔL\* 0.0), carried by a half-strength hairline at 1.3:1 and a drop
that on a near-black ground moves the pixel by 1–4 L\*. Three cues, all of them near zero. Nothing was
separating those surfaces because nothing was left to.

With real ground steps doing the separating, a chrome boundary is **felt, not seen**: `--edge` is a
half-strength `--line`, and it is what the rail, dock, strip, status bar and context dock are bounded with.
`--line` remains the honest divider for a card, a field, a table rule — the places a real edge is the point.

`--divider-rule` is the one quiet rule for seams and group heads: `1px solid var(--edge)`. A caller may
place that rule on a border or use it as the trailing hairline of a heading, but it does not invent another
colour or weight for the same boundary job. The tab strip's content boundary is the band's own inset hairline in
that token, broken under the active tab so it meets its document with no line at all ([[tab-layout]]); the
content host owns no top edge of its own, so there is still one line and one token at that seam.

**A SEAM IS A STEP, NOT A LINE — and the step is built from the ladder itself.** Where the chrome floor
meets the content plane the boundary runs `--ground` · the `--edge` hairline · one pixel of `--panel` ·
`--paper`: four values in three pixels. That middle pixel is what makes the document read as sitting ABOVE
the chrome rather than beside it, and it is the same rung the tab strip is painted in, so it continues across
the top of the content column — broken only under the active tab, which is the document itself
([[tab-layout]]) — and then down its leading edge. This is the whole of the
"raised panel" feel that other editors buy with a drop shadow, and it is why we do not have to:

**One elevation, and depth is not one of its jobs.** `--shadow` is a single drop spent only on things that
genuinely float. Stacking shadows to fake a surface is the failure mode this rule exists to prevent — a
window whose panels each cast their own is a window where nothing reads as a plane and everything reads as
a sticker. A surface earns its depth from the ladder; only a thing that leaves the plane pays the shadow.

**`--shadow` and `--raised` are spent together, and that pairing is the definition of floating.** The drop is
already the sheet's own statement that a thing has left the plane, so the set of rules that spend it is
exactly the set that must be painted the raised rung — which makes the rule checkable instead of remembered.
Before the pairing, twenty-six floating surfaces drew from **three** different rungs depending on which file
they happened to be written in: `--panel` for most menus, `--paper` for the pop-overs, `--panel2` for the
tooltip. That is the real defect the terminal collision was only the loudest symptom of.

**The dark terminal is a WELL, not a card, and it is a MEDIUM rather than a rung.** It is dark in every
theme because the agent's TUI is dark-designed, which in a dark preset makes it the deepest thing in the
window and in a light preset makes it plainly foreign — either way it cannot read as a surface lifted off the
plane, and calling it a card is what let it be painted at a chrome tone and mean nothing. So it is the floor:
a dark preset resolves `--term-bg` to its own deepest value (`:root` says `var(--ground)` and every dark row
inherits that line), a light preset names a neutral near-black outright because its palette has no dark end,
and **no rung may land on it** — a menu the exact value of the pane beneath it is a menu with no boundary.
A small `--paper` gutter still runs down its leading edge so the plane is visible beside it; leading edge
only, because its other three sides meet chrome that steps for them.

The terminal's own ground has **one** source, and it is this token. The terminal package's stylesheet already
resolves `--tt-bg` from it, so the xterm instance reads the same value back rather than repeating it as a
literal — a second copy is what let the ground xterm *declares* drift from the one the pane *paints*, and the
declared one is what an inverse-video cell paints as its foreground. A warm pane outlives any re-theming
around it, so it re-reads when the root element changes ([[terminal-input]] owns the pane's lifetime).

All eight theme presets plus the default carry all four rungs as resolved values; `--ground` is each theme's
own deepest surface where its palette has one, and a derived step below `--panel` where it does not, while
`--raised` is the plane lifted 8% toward white — the same move Material's dark elevation overlay makes, at
the opacity that lands the step in the 6–9 L\* band the reference systems agree on. A preset with a real
elevated tone of its own resolves it outright instead: Rosé Pine Dawn's `surface` IS that tone, which is also
why that preset's chrome had to be re-slotted — it was carrying `surface` as its **sidebar**, so its ladder
ran backwards and a menu opened over the sidebar was painted the sidebar's own value. A theme that resolved
only some of the rungs would silently collapse the ladder for its readers. Each row
also declares its `color-scheme`, so the browser's own chrome — scrollbars, native pickers — sits on the
preset's side of the light/dark line instead of the platform's guess. The theme picker's swatches are read
from those same rows — each preset's ground, paper, ink and accent as the sheet resolves them — never
hand-copied, so a swatch cannot show a palette nobody gets.

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

## interaction

How the board **responds** is vocabulary too, and it is spent through tokens for the same reason colour is:
a preset should be able to retune the feel of a hover or a selection across every surface at once, and a
component that hand-writes its own answer takes itself out of that decision.

- **`--wash-hover`** and **`--wash-active`** are the washes a row, a menu item, a quiet button, or a rail
  entry wears under the pointer and under the press: translucent ink over whatever plane the control sits
  on, so one token reads correctly on paper, panel, and ground alike. Hover is a wash, never a coloured
  border — a border that turns blue on hover says "selected" in a vocabulary where blue is the selection.
- **`--wash-selected`** is the one selection tint: the lit rail entry, the explorer's current row, the
  list's cursor row, a chosen segment. Selection and hover are different facts and wear different washes.
- **`--focus-ring`** is the ONE keyboard focus indication, drawn by a single `:focus-visible` rule as an
  inset shadow so it follows the corner and survives every clipping container. No control writes an
  outline of its own; the only exceptions are the bare inputs whose container draws the focus state (the
  query bar, the archive search, the composer), which decline the ring so the reader never sees two.
- **`--field-bg`** is the bed a text field sits in — paper by default, a soft tint where a preset wants
  fields to read as recessed.

`:root` derives all of them from the palette, so every preset responds coherently without declaring them;
a preset with its own idea of feel sets the tokens, never a component rule. The Notion preset is the
worked example: sans voice, a 4px corner, flat grey washes, a layered popover shadow, and an inset blue
ring — all of it expressed as token values in one row, and none of it a special mechanism.

## the gate

`styles.test.mjs` is this body in executable form: it asserts both role tokens exist, that `--ui-font`
defaults to the mono stack and `--ui-font-sans` stays declared for a preset to resolve (the Notion row
does), that every `font-family` in the sheet names a role token rather than a family and that both roles
are still spent (collapsing language onto `--mono` would weld the board to one family and leave a preset
nothing to flip), that no all-caps or tracked label survives, that exactly three weight tokens are in
use, that the radius and elevation tokens own their properties (a ring drawn as `var(--focus-ring)` is a
border, not a drop), that all nine palettes resolve the full ground ladder and the chrome surfaces spend
it, that the ladder never inverts and every depth step in every preset clears its floor in L\* — the
arithmetic runs in the gate, so a palette edit that flattens a step fails the build instead of shipping —
that the terminal stays the darkest surface and no rung lands on it, that everything spending `--shadow` is
painted `--raised`, that the interaction tokens are declared on `:root` with the one `:focus-visible` ring rule and no
hand-written focus outline left in the sheet, that every `var()` the sheet consumes is declared somewhere
the browser can resolve it — and that the chrome rows [[ui-state-model]]'s budget refused stay retired at
the source. It runs with the unit suite, off the sheet's text, so a rule that drifts from this vocabulary
fails before a browser is involved.
