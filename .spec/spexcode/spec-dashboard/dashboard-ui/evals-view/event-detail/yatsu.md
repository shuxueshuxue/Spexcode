---
scenarios:
  - name: annotate-seek-circle-file
    tags: [frontend-e2e]
    description: >
      On #/evals, select a video reading (carrying a step-timeline sidecar, its thread holding anchored
      comments) in the left list. In the RIGHT detail pane, over the CUSTOM review-track player: read the
      scrubber's comment markers + step bands + duration; click a comment marker and read video.currentTime
      + which comment/marker highlights; play/pause and read the playhead-active comment as it advances;
      frame-step with '.' and jump comments with ↑/↓ and read video.currentTime; press 'a' and read the
      composer's stamped anchor; click a step on the ruler; drag on the paused frame to circle a region,
      read the prefilled comment and send it; click the sent comment's anchor chip; file a fail reading;
      switch selection to another row and back.
    expected: |
      The eval detail IS the event detail — full pane height, no modal — with a CUSTOM player (native chrome
      replaced): a scrubber carrying the play-fill + knob, one MARKER per anchored comment at its moment,
      and step BANDS from the timeline; a live time readout + a chip naming the step the playhead is in.
      Clicking a marker SEEKS to that comment (the blob route answers byte ranges — without them the browser
      clamps to 0) AND selects it: the marker and the comment both highlight, in sync. As the clip plays the
      playhead-ACTIVE comment lights and the step chip flips at each boundary. The keyboard drives it —
      space play/pause, ←→ ±5s (⇧ 1s), , . frame-fine, ↑↓ jump to the prev/next comment (seek + select),
      'a' stamps a `▶m:ss · <step>` anchor into the composer (+ a `[[node]]` line when the step routes
      elsewhere) and focuses it. The named-step ruler still click-seeks. A drag circles a region: the paused
      frame (rect burned in) is POSTed to /api/yatsu/blob and the composer is prefilled with an anchored
      comment — the anchor line, a `![frame](/api/yatsu/blob/<hash>)` link, and the routing line. Sending it
      creates/appends the eval's local Issue thread ('eval: <node> · <scenario>') with that frame in the
      body AND on the thread's typed evidence[]; the sent comment shows an anchor chip that SEEKS + selects
      on click and renders the circled frame inline. '@new' dispatches a fresh worker with the anchor in its
      prompt. The fail reading appends a manual@1 line (verdict + note, NO marks transcript) to the sidecar.
      Switching selection resets the working draft.
  - name: image-lightbox
    tags: [frontend-e2e]
    description: >
      On #/evals select an IMAGE reading. In the detail pane: read the image's cursor style, click it,
      measure the overlay image's rendered size against the viewport, press Esc and read the page hash;
      reopen, click the backdrop.
    expected: |
      The evidence image invites the zoom (cursor zoom-in). A click opens a fixed full-viewport lightbox
      showing the SAME blob near viewport size (max ~96vw/96vh — the pane's width is no longer the
      ceiling). Esc closes ONLY the lightbox — the page stays on #/evals, no page-level Esc handler
      fires; clicking anywhere on the overlay also closes it. Switching selection while open closes it.
  - name: eval-comments
    tags: [frontend-e2e]
    description: >
      On #/evals select an eval. In the detail pane's comments section under the media: send a first
      comment; send a second; confirm /api/issues holds exactly ONE local issue for that concern (and that
      the eval thread is SPLIT OUT of the Issues page's merged list per the eval-remark split); send a third containing
      '@new'. Read /api/issues between sends.
    expected: |
      The first comment lazily CREATES a local issue bound by concern 'eval: <node> · <scenario>'
      (nodes:[node], the comment as body) and it renders in place under the media. The second comment
      APPENDS to that same thread — /api/issues holds exactly ONE local issue with that concern (no
      duplicate thread), now with one reply. The thread IS a real local issue (store local, concern-keyed)
      but — after the eval-remark read-time split — it is EXCLUDED from the Issues page's merged issue
      list (mergedIssues drops isEvalConcern); it surfaces only under its eval, not as an Issues-page row.
      The '@new' comment dispatches a fresh worker through the same write path — the one-line outcome
      ('@ new→<session>') echoes on the page.
  - name: ab-history-flip
    tags: [frontend-e2e]
    description: >
      On #/evals, select a scenario that has MORE THAN ONE reading — a fail (A) followed by a pass (B). In
      the RIGHT detail pane, read the A/B strip's verdict pips and the position label; click the older
      (fail) pip (or press ‹) and read the header verdict badge, the expected/note text, and which evidence
      blob the media points at; then click the newest (pass) pip and read them again. Read the comment
      thread's replies before and after the flips.
    expected: |
      The A/B strip renders one verdict pip per reading, oldest→newest, ✗ for a fail (an A pole) and ✓ for
      a pass (a B pole), the viewed pip outlined. Flipping to the older reading lights its ✗ pip, sets the
      header badge to ✗, and swaps the media/expected/note IN PLACE to that reading's (a different blob hash
      than the latest); flipping back to the newest lights the ✓ pip, badge ✓, media back to the latest,
      and the position label reads 'latest'. The strip is absent for a single-reading scenario. The eval's
      comment thread (bound by concern 'eval: <node> · <scenario>') is IDENTICAL across both flips — it is
      per-scenario, not per-reading, so the annotation track spans the whole A/B.
---
# event-detail loss

YATU through the real browser over a real backend: the seek, the ⏱ anchor, the circled-frame comment (its
frame on /api/yatsu/blob and the thread's evidence[]), the anchor-chip seek, the @new dispatch, and the
verdict reading are all read from live surfaces (DOM, /api/issues, the sidecar file) — never asserted from
the component code. There is ONE annotation primitive (an anchored comment on the eval's thread); the
verdict reading no longer duplicates the marks.
