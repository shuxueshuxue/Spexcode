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
  - name: the-ladder-runs-one-way-under-every-preset
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop Chromium against the running dashboard, open a live session's Terminal tab so the
      three surfaces a reader actually sees at once are on screen together — the session list, the content
      plane with the terminal pane on it, and a right-click menu summoned over the boundary between them.
      For each of the nine presets in turn, read the COMPUTED background of `.si-list`, `.si-content`,
      `.si-term-body`, `.xterm-screen`, and the open `.sess-menu`, convert each to CIE L*, and screenshot
      the menu straddling the sidebar and the terminal.
    expected: >-
      Under every preset the rungs climb in one direction — terminal ≤ sidebar < content plane ≤ menu — the
      plane clears the terminal by at least 4 L* (a region step), and the menu resolves to a different value
      from both surfaces it always overlaps, the sidebar and the terminal, clearing the terminal by at least
      6 L* (an elevation step). WHO CARRIES THE LIFT then splits on the palette's headroom, which is the
      light/dark line: a dark preset pays a real step, lifting the menu at least 6 L* off both the plane and
      the sidebar; a light preset is already at the top of the range, so it may sit the menu on the plane's
      own value and carries the lift with its drop instead — that drop must exist. The xterm screen paints
      the same value the sheet resolves for `--term-bg`. Zero loss = every depth change is carried by at
      least one cue at strength; the failing measurement is a change carried by NOTHING — a menu whose
      ground is byte-identical to the pane it was just opened over, with only a half-strength chrome
      hairline between them.
    code: [spec-dashboard/src/styles.css, spec-dashboard/src/styles.test.mjs]
---
# typography — measurement

The gate (`styles.test.mjs`) proves the vocabulary off the sheet's text. This scenario proves it in a
browser: drive the real dashboard, read computed styles from the DOM (never reason from the sheet), and
switch presets through the real Settings picker. File with
`spex eval add typography --scenario interaction-tokens-drive-hover-selection-focus --pass|--fail`
with a JSON of the read values and a screenshot per theme.
