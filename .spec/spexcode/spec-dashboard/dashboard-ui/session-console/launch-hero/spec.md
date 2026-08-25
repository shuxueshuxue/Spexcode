---
title: launch-hero
hue: 280
desc: The New-Session launch state — the six-line SPEXCODE wordmark above the one input the reader came for.
code:
  - spec-dashboard/src/SessionInterface.jsx#LaunchHero
related:
  - spec-dashboard/src/styles.css
---

# launch-hero

The console's New-Session tab (opened by the sessions dock's `+` door or the existing keyboard binding) is
**the quietest surface in the product**: an empty room waiting for one sentence. It greets with the
product's name and nothing else.

The name is the original six-line ANSI-Shadow ASCII `SPEXCODE` wordmark, rendered as text in the mono voice
and re-themed with the app's shared blue-to-magenta ink. The launch input remains the first control below it,
but the banner is intentional product identity rather than a disposable plain-text heading. This restores the
human's judgment: "原本的 banner 挺好看的,删掉之后页面非常丑".

The banner is deliberately the only large mark in the launch state. It keeps the six-line ANSI-Shadow block
lettering in the mono font and the blue-to-magenta ink, then gives the input its own quiet space below. The
launch state's job is still to make the input the first control in the room; restoring the banner returns the
identity cue that the human noticed was lost when it became plain text.

The input under the banner is the floating composer: a paper card on the plane that pays the one elevation
([[typography]]) behind a felt edge, and whose focus adds the shared ring to that same shadow rather than
recolouring its border — the room stays quiet while the card reads as the thing to type into.

The wordmark is the [[session-console]] New tab's only decorative element; everything else on that tab
(input, launcher chip, hint line) belongs to the console's launch grammar, not to this node.
