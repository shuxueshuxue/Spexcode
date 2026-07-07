---
scenarios:
  - name: time-axis-step-rail-unchanged
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EventDetail.jsx, spec-yatsu/src/timeline.ts]
    description: >
      File a VIDEO reading carrying a LEGACY v1 step-timeline (`{ "v": 1, "events": [{ "tMs", "step" }] }`)
      on a node, open that node's Eval tab in the dashboard, select the reading, and read the custom
      review-track player's DOM: the step BANDS on the scrubber (`.an-band`, positioned by `tMs/duration`)
      and the step RULER under it (`.an-ruler` buttons). Read each ruler button's label text.
    expected: |
      The video renders under the custom scrubber with step bands at each step's `tMs/duration` and a step
      ruler whose buttons read `m:ss <step>` — BYTE-FOR-BYTE what it rendered before the axis
      generalization. A legacy v1 timeline reads losslessly as the `time` axis (normalized `axis:'time'`,
      `at = tMs`), so the video step-rail capability is preserved exactly; the m:ss label is the `time`
      case of the axis-keyed formatter. The clip still plays, markers still seek.
  - name: line-axis-step-rail
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EventDetail.jsx, spec-yatsu/src/cli.ts]
    description: >
      File a NON-video reading whose evidence is a `--result` transcript plus a v2 `axis:'line'` step-map
      (`{ "v": 2, "axis": "line", "events": [{ "at": <line-no>, "step" }] }`) — no `--video`. Open that
      node's Eval tab, select the reading, and read the detail's DOM: is a step RAIL (`.an-ruler`) present
      even with no clip, and what do its button labels read?
    expected: |
      The eval detail shows a step rail (`.an-ruler`) UNDER the transcript even though there is no video —
      the rail is no longer welded to the clip. Each step button reads `L<line-no> <step>` (the `line`-axis
      label, not m:ss), naming the step at its line position. No custom video scrubber renders (no clip);
      the `--timeline` filed clean beside a transcript because the CLI's axis↔kind gate accepts a `line`
      map on a transcript entry. This is the axis generalization's payoff: step evidence on any axis.
---
# step-timeline loss

YATU through the real browser: the step map is measured by the RAIL the dashboard actually renders from it,
not by reasoning about `timeline.ts`. Two axes prove the generalization is lossless AND real — the `time`
axis (a legacy v1 video map) must render its bands + m:ss ruler unchanged, and a `line` axis (a transcript
map) must render a rail with `L<n>` labels where before there was none. The format schema (v1/v2 validate +
normalize) and the CLI axis↔kind gate are the units under it; the measured truth is the rail the browser draws.
