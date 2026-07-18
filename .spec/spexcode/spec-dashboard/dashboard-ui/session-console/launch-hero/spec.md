---
title: launch-hero
hue: 280
desc: The New-Session splash — a terminal-style block-letter SPEXCODE wordmark, themed by the active palette.
code:
  - spec-dashboard/src/SessionInterface.jsx#LaunchHero
related:
  - spec-dashboard/src/styles.css
---

# launch-hero

The console's New-Session tab greets with a **splash in the terminal's own language** — the block-letter
ASCII wordmark every code CLI opens with (Codex's `>_`, Gemini's and opencode's ███ block lettering) —
instead of an app-icon glyph. The human's direction is the contract here: the launch surface should *feel
like a terminal*, and in a terminal identity is drawn with characters, not vector art.

So the hero is **pure text**: an ANSI-Shadow `SPEXCODE` rendered in the app's mono font inside a `pre` —
a rigid character grid, never an image or SVG, so it scales by font-size alone and stays aligned at any
width. Its ink is a vertical gradient from the **active theme's** `--blue` to `--magenta` (background-clip:
text), which keeps the console's rule that re-theming the app re-inks the console with it — light themes
included, no hero-scoped palette. The `session.ask` line stays beneath it as the prompt's question.

The wordmark is the [[session-console]] New tab's only decorative element; everything else on that tab
(input, launcher chip, hint line) belongs to the console's launch grammar, not to this node.
