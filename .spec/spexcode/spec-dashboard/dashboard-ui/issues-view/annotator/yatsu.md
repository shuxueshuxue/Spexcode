---
scenarios:
  - name: annotate-seek-circle-file
    tags: [frontend-e2e]
    description: >
      On #/forum, select a video reading (carrying a step-timeline sidecar) in the left list. In the
      RIGHT detail pane: click a step on the ruler and read video.currentTime; press ⏱ in the review-track
      composer and read the inserted anchor line; drag on the paused frame to circle a region, then read
      the prefilled comment and send it; click the sent comment's anchor chip and read video.currentTime;
      send another comment containing '@new'; file a fail reading; switch selection to another row and back.
    expected: |
      The eval detail IS the annotator — full pane height, no modal. The step ruler renders one button per
      timeline event; clicking one SEEKS the video to its tMs (the blob route answers byte ranges —
      without them the browser clamps to 0). ⏱ inserts a `▶m:ss · <step>` anchor line at the composer's
      head (time + the ≤T step). A drag circles a region: the paused frame (rect burned in) is POSTed to
      /api/yatsu/blob and the composer is prefilled with an anchored comment — the anchor line, a
      `![frame](/api/yatsu/blob/<hash>)` link, and a `[[node]]` line when the step routes elsewhere.
      Sending it creates/appends the eval's local Issue thread ('eval: <node> · <scenario>') with that
      frame in the body AND on the thread's typed evidence[]; the sent comment shows an anchor chip that
      SEEKS the clip on click and renders the circled frame inline. '@new' dispatches a fresh worker with
      the anchor in its prompt ('@ new→<session>' echoes). The fail reading appends a manual@1 line
      (verdict + note, NO marks transcript) to the sidecar. Switching selection resets the working draft.
  - name: image-lightbox
    tags: [frontend-e2e]
    description: >
      On #/forum select an IMAGE reading. In the detail pane: read the image's cursor style, click it,
      measure the overlay image's rendered size against the viewport, press Esc and read the page hash;
      reopen, click the backdrop.
    expected: |
      The evidence image invites the zoom (cursor zoom-in). A click opens a fixed full-viewport lightbox
      showing the SAME blob near viewport size (max ~96vw/96vh — the pane's width is no longer the
      ceiling). Esc closes ONLY the lightbox — the page stays on #/forum, no page-level Esc handler
      fires; clicking anywhere on the overlay also closes it. Switching selection while open closes it.
  - name: eval-comments
    tags: [frontend-e2e]
    description: >
      On #/forum select an eval. In the detail pane's comments section under the media: send a first
      comment; send a second; look for the thread in the issues group; send a third containing '@new'.
      Read /api/issues between sends.
    expected: |
      The first comment lazily CREATES a local issue bound by concern 'eval: <node> · <scenario>'
      (nodes:[node], the comment as body) and it renders in place under the media. The second comment
      APPENDS to that same thread — /api/issues holds exactly ONE local issue with that concern (no
      duplicate thread), now with one reply. The thread lists in the issues group like any local issue
      (store chip local, the concern-key row). The '@new' comment dispatches a fresh worker through the
      same write path — the one-line outcome ('@ new→<session>') echoes on the page.
  - name: ab-history-flip
    tags: [frontend-e2e]
    description: >
      On #/forum, select a scenario that has MORE THAN ONE reading — a fail (A) followed by a pass (B). In
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
# annotator loss

YATU through the real browser over a real backend: the seek, the ⏱ anchor, the circled-frame comment (its
frame on /api/yatsu/blob and the thread's evidence[]), the anchor-chip seek, the @new dispatch, and the
verdict reading are all read from live surfaces (DOM, /api/issues, the sidecar file) — never asserted from
the component code. There is ONE annotation primitive (an anchored comment on the eval's thread); the
verdict reading no longer duplicates the marks.
