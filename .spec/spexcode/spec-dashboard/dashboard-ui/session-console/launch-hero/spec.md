---
title: launch-hero
hue: 280
desc: The New-Session launch state — the product's name set as quiet type above the one input the reader came for.
code:
  - spec-dashboard/src/SessionInterface.jsx#LaunchHero
related:
  - spec-dashboard/src/styles.css
---

# launch-hero

The console's New-Session tab (opened by the sessions dock's `+` door or the existing keyboard binding) is
**the quietest surface in the product**: an empty room waiting for one sentence. It greets with the
product's name and nothing else.

The name is **type, not a picture**: the wordmark set once at the page's single statement size
([[typography]]'s `--type-display`), at regular weight, in the muted ink, with the page's space ladder
holding it off the input below. It is still pure text and still re-themes with the app, because it spends
only shared tokens.

**What it replaced, and why.** The hero used to be six lines of ANSI-Shadow block lettering in the mono
font, ink-filled with a `--blue`→`--magenta` gradient — a terminal's idea of a logo, at a size nothing else
on the board is allowed, followed by a spacer standing in for a caption that had already been retired. It
read as a costume. The launch state's job is to make the input the lit thing in the room; a sign that
shouts above it competes with the one control the reader came to use. Restraint here is the same rule the
rest of the surface follows — hierarchy is spent on space, then colour, then weight, then size, and this
page spends its one size on the name and then stops.

The wordmark is the [[session-console]] New tab's only decorative element; everything else on that tab
(input, launcher chip, hint line) belongs to the console's launch grammar, not to this node.
