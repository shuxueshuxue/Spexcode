# Brand assets

The mark is **two brackets holding one file**: code bound to a contract rather than asserted to match
it, and the file is there because a spec governs exactly one file. Ink `#171A20`, paper `#EFE8D8`,
accent `#16495A` (`#5FA8BE` on dark ground, where the darker teal loses contrast).

| file | what it is |
| --- | --- |
| `banner-dark.svg` | the lockup. `../banner.png` is this file rasterised at 2×. |
| `banner-light.svg` | the same lockup for a light ground |
| `social.svg` / `social.png` | GitHub's social preview card, 1280×640 |
| `mark.svg`, `mark-dark.svg`, `mark-mono.svg` | the mark alone, tiled, 512×512 |
| `mark-bare.svg` | the mark with no field, for a page that supplies its own ground |

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
