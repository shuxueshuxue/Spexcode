---
scenarios:
  - name: declared-scenarios-visible-without-readings
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard, focus a node that declares scenarios but has none measured yet (a yatsu.md
      with no readings — or use a route fixture that sets a node's `evals` to []), and open its eval
      tab (key `4`). The tab must NOT dead-end at a bare "no measurements yet" line: under that hint it
      lists each DECLARED scenario as a blind-spot row — an empty score ring, the scenario name, the
      files it tracks, and its `expected`. For a node where some scenarios are measured and others not,
      the unmeasured ones LEAD the one reading timeline as the same kind of blind-spot row (no fenced-off
      band, no second scrollbar — the empty ring is the only distinction). Screenshot the popup's eval tab and file with
      `spex yatsu eval eval-tab --scenario declared-scenarios-visible-without-readings --image <png> --pass`.
    expected: >-
      The eval tab surfaces the WHOLE declared set, not only the readings: a scenario with no reading
      shows its name + expected (+ tracked files) under a blind-spot ring, so a node's measurable intent
      is legible inside the popup even before any reading lands — the only place it shows once the popup
      covers the focus panel. No reading at all → the declared list under a hint; some measured, some not
      → those same rows lead the one timeline (the empty ring is the only distinction, not a separate band).
    code:
      - spec-dashboard/src/NodeView.jsx
      - spec-dashboard/src/styles.css
  - name: multi-evidence-gallery
    tags: [frontend-e2e, desktop]
    description: >-
      File one reading carrying MULTIPLE evidence entries — several `--image` stills AND a `--video`
      clip — against a node, open that node's eval tab (key `4`), and expand the reading. Its evidence
      must render as a GALLERY: every image shows AND the video plays inline, together in the one
      expanded figure — not a single element switched on one kind. A pruned entry shows its own
      *miss original file* sentinel. Screenshot the expanded gallery and file with
      `spex yatsu eval eval-tab --scenario multi-evidence-gallery --image a.png --image b.png --video clip.webm --pass --image <shot>`.
    expected: >-
      The expanded reading shows the reading's whole evidence LIST as a vertical gallery: N `<img>`
      thumbnails plus an inline `<video controls>`, all present at once. Backward-compatible — a legacy
      one-blob reading still renders as a single-item gallery. Each entry resolves its own blob state, so
      one missing entry degrades to the sentinel without hiding the others.
    code:
      - spec-dashboard/src/NodeView.jsx
      - spec-dashboard/src/styles.css
---
# eval.md — eval-tab

Product surface, measured by **looking** (YATU): the agent opens the dashboard, opens a node's eval tab in
the two states that have no reading to expand (none measured, and some-but-not-all measured), and
screenshots that the DECLARED scenarios are visible — name, expected, tracked files, blind-spot ring — not
only a hint to go measure them. The scenario scopes its freshness `code:` to the eval tab's own component
(`NodeView.jsx`) and its stylesheet slice — the [[eval-tab]] read engine in `evaltab.ts` already
ships the declared set on the board, so this measures only the surface that renders it.
