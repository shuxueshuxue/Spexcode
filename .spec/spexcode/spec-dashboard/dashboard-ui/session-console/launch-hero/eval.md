---
scenarios:
  - name: block-wordmark-splash
    tags: [frontend-e2e, desktop]
    description: >
      Open the dashboard's session console on the New Session tab in a real browser and look at the
      splash above the input. Switch the app theme (e.g. minimal → tokyonight → a light theme like
      things) and look again.
    expected: |
      The splash is a block-letter ASCII "SPEXCODE" wordmark (ANSI-Shadow style █/╔╝ characters) rendered
      as text in the app's mono font — not an SVG or image — with a vertical blue→magenta gradient taken
      from the active theme's palette. Switching the theme re-inks the wordmark (light themes keep it
      legible on their paper). No caption line renders beneath it, but the spacing between the wordmark
      and the input keeps the retired ask line's slot (no collapsed gap), and the rows of
      the wordmark stay a rigidly aligned character grid at any window width.
    code: spec-dashboard/src/SessionInterface.jsx
---

# launch-hero loss

YATU through the real console: the loss watched is the launch surface greeting with something that isn't
terminal-native (an app-icon glyph, a broken/misaligned character grid, or a hero that ignores the theme).
Measured by opening the actual New Session tab and reading what renders, across themes.
