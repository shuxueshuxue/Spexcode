---
scenarios:
  - name: shared-icon-buttons
    description: >
      Open the running dashboard in a real browser. The converted icon buttons must render real stroke
      SVGs from the shared icons.jsx vocabulary, each keeping its tooltip/accessible name: the issues
      page New button (.fv-new-btn) is a ＋ plus icon with title/aria-label "New"; the session console's
      New pill (.si-pill.new) and search pill draw the plus/magnifier from the same set; a modal's close
      control (.legend-close) is an × icon with the close label; the annotator's A/B walkers (.an-ab-nav)
      are chevron icons and its play control (.an-play) a play/pause icon; the side rail still shows its
      five page glyphs via <Icon>. The Issues page's open rows use that same registry for Primer's original
      filled 16px `issue-opened` Octicon, not a component-local SVG or CSS dot.
    expected: >
      Screenshots show each converted control rendering its SVG glyph (no unicode text ＋ × ⏸ ▶ ‹ › in
      the buttons), and DOM reads confirm every icon-only button carries both title and aria-label. Open
      issue rows render the shared registry's two-path 16px `issue-opened` fill geometry in semantic green.
    tags: [frontend-e2e]
    code: [spec-dashboard/src/icons.jsx]
  - name: harness-product-marks
    description: >
      Open the running dashboard's New-Session launcher picker in a real browser, on a project whose
      config defines one launcher per harness (claude, codex, opencode, pi). The trigger and every
      pop-out row must wear that harness's OWN official product mark (the Claude spark, the Codex ring,
      the opencode nested squares, the pi P-mark) — not a vendor-company logo, and never a wrong-harness
      fallback for opencode/pi. Marks are fill-based `si-agent-glyph` SVGs inheriting currentColor, so
      they must read in both the light and dark theme.
    expected: >
      Screenshots of the opened launcher pop-out (light + dark) show four distinct product marks, one
      per harness row; DOM reads confirm four `.si-launcher-row`s each containing an `svg.si-agent-glyph`
      with a distinct path signature (no two rows share one glyph, i.e. no claude-fallback for
      opencode/pi).
    tags: [frontend-e2e]
    code: [spec-dashboard/src/harness.jsx]
---

Measure YATU: run the worktree dashboard (vite; symlink node_modules first) against a spex backend,
drive headless Chromium to #/issues, #/sessions and a modal, read each button's innerHTML (must contain
`<svg`), its `title` and `aria-label`, and screenshot the rendered controls.
