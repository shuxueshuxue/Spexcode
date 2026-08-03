# Brand assets

The mark is **two brackets holding one file**: code bound to a contract rather than asserted to match
it, and the file is there because a spec governs exactly one file. The file is **cleft corner to corner
and rebuilt on the upper side of the cleft** — that half is a brighter material and the light in the
seam comes from the crack itself, so the mark says the code was regenerated from its spec and came back
better. Ink `#171A20`, paper `#EFE8D8`.

## The cleft

The cut runs the block's main diagonal, which is parallel to its chamfer, so the crack and the file's
own corner are the same gesture. It folds exactly twice, at 44% and 56% of its length with a ±20-unit
throw: the two straight runs stay long and the crossing stroke is short and steep. Two folds is the
budget — with both ends pinned to opposite corners, the outer segments have to tilt to reach a displaced
middle, so a crisp *straight → sideways → straight* step is not available under two folds; it costs four.

| | at the seam → outward | seam |
| --- | --- | --- |
| old half, paper ground | `#22687E` → `#123E4D` | `#9ADCEC` at 12 units |
| new half, paper ground | `#6FC0D8` → `#2A7188` | |
| old half, dark ground | `#3D8CA4` → `#276F86` | `#E4F7FD` at 12 units |
| new half, dark ground | `#A6DEEE` → `#5FA8BE` | |
| single ink | `#171A20` | `#EFE8D8` at **8** units |

Both surface gradients start **at the seam** and fall off outward, which is what makes the crack read as
the light source rather than as damage.

Three measured constraints hold this together, and breaking any of them breaks the mark at size:

- **The coloured seam is ink, not a gap.** A paper gap removes mass, and at 16px the block is only
  4.4px across, so a full-width gap hollows it into a ring. An inked seam costs nothing, which is the
  only reason the cut may run corner to corner at all.
- **The single-ink seam is therefore thinner**, 8 units rather than 12 — there the seam *is* paper and
  does cost mass. At 12 the mono block reads broken by 32px.
- **The seam disappears before the mark does.** Below about 24px the seam merges and the two-tone split
  carries the whole idea; the split survives because it changes no silhouette. Do not widen the seam to
  fight this — widening is what destroys the block.

The gradients flatten to their midpoints in the 24-unit dashboard preset, which has no room for a ramp.

| file | what it is |
| --- | --- |
| `banner-dark.svg` | the lockup, 1280×221. `../banner.png` is this file rasterised at 2×. |
| `banner-light.svg` | the same lockup for a light ground |
| `social.svg` / `social.png` | GitHub's social preview card, 1280×640 |
| `mark.svg`, `mark-dark.svg`, `mark-mono.svg` | the mark alone, tiled, 512×512 |
| `mark-bare.svg` | the mark with no field, for a page that supplies its own ground |

The banner is cropped to the artwork, not to the icon's tile. The tile is 200 units square but is
dropped here (on paper it renders as a ghost rectangle rather than a container), so the visible mark is
only the bracket paths — 96..416 of the icon's 512 viewBox, 125 units. Padding measured from the tile
gave a banner that was 40% ink and 60% air; it is now 48 units of clearance around the 125 the eye
actually sees.

Each file carries its own background. That is deliberate rather than lazy: GitHub renders a README on
both a light and a dark theme and serves these as `<img>`, which cannot answer a `prefers-color-scheme`
query, so a transparent asset would be illegible on one of the two.

## The wordmark is outlined, and what that costs

Every glyph in these files is path data, not text. A `font-family` in an SVG served as an `<img>`
resolves on the *reader's* machine, so live text renders differently for everyone and disappears for
anyone without the face.

The cost is that **the tagline cannot be edited as text** — changing it means re-setting the type. This
is the only place the settings are recorded:

| | |
| --- | --- |
| wordmark | Nimbus Sans Bold, 88pt in the banner / 132pt on the social card, tracking −1.2 / −2.0 |
| tagline | Liberation Mono Regular, 21pt / 26pt, tracking +0.4 / +0.5 |
| kerning | hand-set; the face ships no `kern` table. In em/1000: `ex` −14, `xC` −26, `Co` −12, `od` −6, `Sp` −8 |

Nimbus Sans is URW's Helvetica clone and Liberation Mono is metric-compatible with Courier New; both are
in `fonts-urw-base35` and `fonts-liberation`. Conversion was done with `fontTools`, drawing each glyph
through an `SVGPathPen` under a `scale(s, -s)` transform (font space is y-up, SVG is y-down).

The tagline sits in an 840px column beside the icon and Liberation Mono advances 12.6px per character at
21pt, so a replacement longer than about 66 characters will overrun it.

## Why the tagline says what it says

Every word is taken from the repository rather than chosen for sound:

- **spec-driven** — the root spec's own `desc:` field, `A spec-driven, self-developing dev tool`.
  (`spec-first`, which appears far more often, is the name of the *discipline*; `spec-driven` is what the
  tool *is*.)
- **orchestration** — `spec-cli/src/doctor.ts`, Layer 4: `session orchestration (backend-only: dispatch ·
  queue · comms)`.
- **coding agents** — the README's opening paragraph: `dispatches coding agents into isolated worktrees`.

And one word is deliberately absent. **Automation** would contradict the sentence immediately after it in
that same paragraph — *You review and merge* — and the rule the dogfood ritual is built on, that the doer
never merges itself. The tool coordinates the work; it does not remove the human gate, and the banner
should not promise that it does.
