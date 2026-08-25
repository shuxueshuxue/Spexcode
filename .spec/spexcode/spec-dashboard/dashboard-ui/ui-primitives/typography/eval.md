---
scenarios:
  - name: interaction-tokens-drive-hover-selection-focus
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop Chromium against the running dashboard, under the Minimal default and then under
      the Notion preset (chosen through the real Settings picker), open `#/spec`. Read the computed
      background of an Explorer row at rest and while hovered, the computed background of the lit rail
      entry, and — after moving keyboard focus onto a rail entry with Tab — that entry's computed
      `box-shadow` and `outline-style`. Read the resolved `--wash-hover`, `--wash-selected`, and
      `--focus-ring` tokens on the root in each theme.
    expected: >-
      In both themes the hovered row's background equals the resolved `--wash-hover` (transparent at rest),
      the lit rail entry's background equals the resolved `--wash-selected`, and the focused entry shows an
      inset ring equal to `--focus-ring` with `outline-style: none`. The three resolved values differ
      between the two themes (Minimal derives them from its palette; Notion resolves flat greys and an inset
      blue ring), while the rules that consume them are the same. Zero loss = one token per interaction,
      spent by every surface, retuned by a preset alone.
    code: [spec-dashboard/src/styles.css, spec-dashboard/src/styles.test.mjs]
---
# typography — measurement

The gate (`styles.test.mjs`) proves the vocabulary off the sheet's text. This scenario proves it in a
browser: drive the real dashboard, read computed styles from the DOM (never reason from the sheet), and
switch presets through the real Settings picker. File with
`spex eval add typography --scenario interaction-tokens-drive-hover-selection-focus --pass|--fail`
with a JSON of the read values and a screenshot per theme.
