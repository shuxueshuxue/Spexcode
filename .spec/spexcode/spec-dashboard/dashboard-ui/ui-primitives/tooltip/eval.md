---
scenarios:
  - name: theme-adaptive-bubble
    tags: [frontend-e2e, desktop]
    description: >
      Run the dashboard in a real browser. Hover (or keyboard-focus) the same data-tip control — e.g. a
      side-rail button — once under the default Minimal preset and once under Things (a dark and a light
      palette; flip via the settings picker or document.documentElement data-theme). Screenshot the
      visible bubble in each theme.
    expected: >
      Both presets show the app-drawn .ui-tip bubble, never the browser-default title box: Minimal
      renders the graphite palette (light ink, hairline border), Things the white palette (dark ink) —
      background, text, border, and shadow all legible in both. In each preset the bubble's background is
      that preset's resolved `--raised`, because a tooltip is a thing that has left the plane and every
      such surface is painted the one rung above it ([[typography]]); it does not carry a chip tone of its
      own. Zero loss = one tooltip, correctly skinned per preset, purely from the CSS variables.
    code: [spec-dashboard/src/Tooltip.jsx, spec-dashboard/src/styles.css]
  - name: hover-delay-and-edge-flip
    tags: [frontend-e2e, desktop]
    description: >
      In the running dashboard, hover a data-tip control and watch timing and placement: the bubble must
      NOT appear instantly (an ~400ms intent delay), then appear above the anchor with the arrow pointing
      at it. Then trigger a control near the viewport's top edge (e.g. a top-strip button): the bubble
      must flip below instead of clipping. Screenshot both placements.
    expected: >
      No bubble in the first ~quarter second of hover; after the delay it fades in above the anchor.
      A top-edge anchor renders the bubble BELOW itself (data-place=bottom, arrow on top). Zero loss =
      delay, default-above placement, and the clip-flip all observable in the real DOM.
    code: [spec-dashboard/src/Tooltip.jsx]
  - name: keyboard-focus-shows-tip
    tags: [frontend-e2e, desktop]
    description: >
      With the dashboard running, Tab (keyboard, no pointer) onto a data-tip control such as a rail
      button. The tooltip must appear without any hover, and the focused anchor must carry
      aria-describedby pointing at the role=tooltip bubble; its aria-label must still be present.
      Esc dismisses.
    expected: >
      Keyboard focus alone shows the bubble immediately; the anchor reads aria-describedby="ui-tip" while
      it is up and keeps its aria-label; Esc hides it. Zero loss = the tip is keyboard-reachable and
      exposed to AT through both channels, not a hover-only visual.
    code: [spec-dashboard/src/Tooltip.jsx]
  - name: pop-grows-from-the-anchor
    tags: [frontend-e2e, desktop]
    description: >-
      In the running dashboard, hover a real data-tip control and sample the bubble's computed transform
      FROM INSIDE THE PAGE, starting on the frame it is inserted — a driver round-trip is longer than the
      whole transition, so an out-of-process "hover then look" can only ever observe the settled state. Read
      the first frame's scale and opacity, the settled scale, and the computed transform-origin against the
      resolved placement. Then hover a control near the top edge so the bubble flips below.
    expected: >-
      The first sampled frame is already scaled DOWN (≈.94) at opacity 0 and grows to scale 1 — a bubble
      whose first frame is scale 1 has degraded to a plain fade, which is exactly what happens when the
      start state lives only under `[data-place=…]`: the element mounts a frame before the placement pass
      stamps that attribute, so the start state is never painted. The origin sits on the ARROW side of the
      resolved placement (y=0 when it hangs below, y=height when it sits above) and x at the bubble's
      mid-width, so the growth points back at the anchor. Zero loss = a measured pop, not an asserted one.
    code: [spec-dashboard/src/Tooltip.jsx, spec-dashboard/src/styles.css]
---
# tooltip — measurement

YATU: measure through the running dashboard in a headless browser (worktree `npm run dev` +
`spex serve`), reading the real DOM (`#ui-tip` presence, `data-place`, computed background) and filing
screenshots per theme with `spex yatsu eval tooltip --scenario <s> --image <png>`. Never reason from the
source: the browser's rendered bubble is the reading.
