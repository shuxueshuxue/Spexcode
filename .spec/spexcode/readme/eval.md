---
scenarios:
  - name: renders-with-all-assets
    description: >
      Extract every local <img src> and markdown link target from README.md and docs/README.zh-CN.md
      and assert each resolves to a file in the repo; then render the six readme diagram assets in a
      real browser (light page ground, the assets' own backgrounds) and inspect the screenshots,
      including the animated terminal advanced to its revealed state (shift animations to a mid-cycle
      time and screenshot).
    expected: >
      Every local reference in both READMEs resolves. The six diagrams render with intact layout in
      the brand palette — no clipped text, no tofu (CJK renders in the zh worker-flow diagram) — and
      the animated terminal's revealed frame shows the typed command plus all five session rows and
      the key line.
    tags: [frontend-e2e]
    code: [README.md]
    related:
      - docs/README.zh-CN.md
      - docs/readme-model.svg
      - docs/readme-drift-flow.svg
      - docs/readme-layers.svg
      - docs/readme-worker-flow.svg
      - docs/readme-worker-flow.zh.svg
      - docs/readme-sessions.svg
---
# eval — readme

Measure as a reader would meet the page: the assets rendered by a real browser (GitHub serves them
as `<img>`), never by reasoning about the SVG source. The reference sweep is mechanical (parse the
markdown, stat the paths); the render judgment is visual, from screenshots.
