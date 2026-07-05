---
scenarios:
  - name: workspace-no-pingpong
    tags: [frontend-e2e, desktop]
    description: >
      On #/evals, select a video reading whose thread holds several anchored remarks. Measure the detail
      pane's geometry: the header band's height and contents; whether the media stage AND the remark
      rail's composer are BOTH within the viewport at once (getBoundingClientRect on the video and on the
      composer textarea); scroll the rail's remark list and read whether the video moved; type into the
      composer and read whether the stage scrolled. Then narrow the window under the breakpoint and
      re-read the layout.
    expected: |
      The detail is a WORKSPACE, not a scroll stack: a slim header (scenario · node · verdict badge ·
      A/B strip), then the media stage and the remark rail SIDE BY SIDE — the video and the composer are
      simultaneously visible with NO scrolling (the composer is docked at the rail's foot, never below
      the media/gallery/thread stack). Scrolling the rail's remark list never moves the stage; the stage
      scrolls itself when its gallery overflows. Circle→remark→circle needs zero vertical travel — the
      old top-bottom ping-pong is gone. Under the narrow breakpoint the workspace degrades to one
      stacked column (stage over rail) instead of clipping.
  - name: stale-reading-readout
    tags: [frontend-e2e]
    description: >
      On #/evals, select a reading whose node's governed code changed after it was taken (a code-stale
      reading — the muted ✓/✗ in the list). Read the detail's stage: is there a stale readout naming the
      moved axes, and for the code axis the drifted file(s) + how many commits behind? Then confirm the
      remark composer works on it exactly as on a fresh reading (type + send a remark).
    expected: |
      A non-fresh viewed reading shows a stale readout on the stage: the freshness axes that moved
      (e.g. `code · scenario`), and for the code axis the drifted governed file(s) with a commits-behind
      count (e.g. `EvalsFeed.jsx +3`). A fresh reading shows NO readout. The readout is reporting only —
      selecting/flipping A/B re-renders it for the viewed reading. The remark composer is unaffected by
      freshness: a remark is authored and sent on a stale reading identically to a fresh one.
  - name: annotate-seek-circle-file
    tags: [frontend-e2e]
    description: >
      On #/evals, select a video reading (carrying a step-timeline sidecar, its thread holding anchored
      comments) in the left list. On the detail workspace's MEDIA STAGE, over the CUSTOM review-track
      player: read the scrubber's comment markers + step bands + duration; click a comment marker and read
      video.currentTime + which comment/marker highlights (the comment lives in the RIGHT RAIL);
      play/pause and read the playhead-active rail comment as it advances; frame-step with '.' and jump
      comments with ↑/↓ and read video.currentTime; press 'a' and read the rail composer's stamped anchor;
      click a step on the ruler; drag on the paused frame to circle a region, read the prefilled composer
      and send it; click the sent comment's anchor chip; read the pane's DOM for any verdict-filing
      controls (pass/fail buttons, a note input, a file-reading action); switch selection to another row
      and back.
    expected: |
      The eval detail IS the event detail — a full-height workspace, no modal — with a CUSTOM player
      (native chrome replaced) on the stage: a scrubber carrying the play-fill + knob, one MARKER per
      anchored comment at its moment, and step BANDS from the timeline; a live time readout + a chip
      naming the step the playhead is in. Clicking a marker SEEKS to that comment (the blob route answers
      byte ranges — without them the browser clamps to 0) AND selects it: the marker and the rail comment
      both highlight, in sync. As the clip plays the playhead-ACTIVE comment lights and the step chip
      flips at each boundary. The keyboard drives it — space play/pause, ←→ ±5s (⇧ 1s), , . frame-fine,
      ↑↓ jump to the prev/next comment (seek + select), 'a' stamps a `▶m:ss · <step>` anchor into the
      rail's docked composer (+ a `[[node]]` line when the step routes elsewhere) and focuses it. The
      named-step ruler still click-seeks. A drag circles a region: the paused frame (rect burned in) is
      POSTed to /api/yatsu/blob and the composer is prefilled with an anchored comment — the anchor line,
      a `![frame](/api/yatsu/blob/<hash>)` link, and the routing line — with the stage still on screen.
      Sending it creates/appends the eval's local Issue thread ('eval: <node> · <scenario>') with that
      frame in the body AND on the thread's typed evidence[]; the sent comment shows an anchor chip that
      SEEKS + selects on click and renders the circled frame inline. '@new' dispatches a fresh worker
      with the anchor in its prompt. The pane carries NO verdict-filing controls — no pass/fail bar, no
      verdict-note input, no file-reading button (readings are filed by agents via `spex yatsu eval`; the
      human judges through the remark composer). Switching selection resets the working draft.
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
      On #/evals select an eval with no existing remark thread. In the detail workspace's remark rail:
      send a first comment; send a second; confirm the trunk store holds exactly ONE local issue for that
      concern — read it from the board overlay's `entry.thread` (or the store's git log), since
      /api/issues excludes eval concerns by construction — and that no row for it renders on #/issues;
      send a third containing '@new'. Read the overlay between sends.
    expected: |
      The first comment lazily CREATES a local issue bound by concern 'eval: <node> · <scenario>'
      (nodes:[node], the comment its first reply) and it renders in place in the rail's remark list. The
      second comment APPENDS to that same thread — the store holds exactly ONE local issue with that
      concern (no duplicate thread), now with two replies, both carried by the board overlay's
      `entry.thread`. The thread IS a real local issue (store local, concern-keyed) but — after the
      eval-remark read-time split — it is EXCLUDED from the merged issue list server-side (/api/issues'
      mergedIssues drops isEvalConcern); it surfaces only under its eval, never as an Issues-page row.
      The '@new' comment dispatches a fresh worker through the same write path — the one-line outcome
      ('@ new→<session>') echoes on the page.
  - name: ab-history-flip
    tags: [frontend-e2e]
    description: >
      On #/evals, select a scenario that has MORE THAN ONE reading — a fail (A) followed by a pass (B). In
      the detail workspace's HEADER band, read the A/B strip's verdict pips and the position label; click
      the older (fail) pip (or press ‹) and read the header verdict badge, the expected/note text, and
      which evidence blob the media points at; then click the newest (pass) pip and read them again. Read
      the rail's remark thread before and after the flips.
    expected: |
      The A/B strip rides the slim header band (right-aligned), one verdict pip per reading,
      oldest→newest, ✗ for a fail (an A pole) and ✓ for a pass (a B pole), the viewed pip outlined.
      Flipping to the older reading lights its ✗ pip, sets the
      header badge to ✗, and swaps the media/expected/note IN PLACE to that reading's (a different blob hash
      than the latest); flipping back to the newest lights the ✓ pip, badge ✓, media back to the latest,
      and the position label reads 'latest'. The strip is absent for a single-reading scenario. The eval's
      remark thread (bound by concern 'eval: <node> · <scenario>') is IDENTICAL across both flips — it is
      per-scenario, not per-reading, so the annotation track spans the whole A/B.
  - name: originator-liveness-shown
    tags: [frontend-e2e]
    code: spec-dashboard/src/EventDetail.jsx
    description: >
      On #/evals, select a video reading whose LATEST reading carries a `by` (the session that filed it)
      that is an ONLINE board session. In the detail workspace's HEADER band, read the filer pill
      (`.fv-originator`): the originator id, its alive/offline class, the dot's computed colour, and the
      title/reach phrase (which must read as an EVAL, not an issue). Confirm a reading with no `by`
      (a legacy reading) shows no filer pill.
    expected: |
      The header surfaces the FILER — the session that filed the viewed scenario's latest reading (from
      `evalTimeline`'s per-reading `by`) — with a liveness dot: an ONLINE filer reads `alive` (a
      status-hued dot from the board's `STATUS_COLOR`, the reach phrase "alive · replies reach it live"),
      an absent/offline filer reads `offline` ("offline · replies skip it"). The title names it an EVAL
      ("session that filed this eval … un-@'d remarks courtesy-deliver to it while alive"), the same
      shared `OriginatorLiveness` the issues header uses, distinct only in wording. A legacy reading with
      no `by` resolves to nobody and the header simply shows no filer pill — exactly the case where the
      loop-in chain runs dry silently. No second palette, no page errors.
---
# event-detail loss

YATU through the real browser over a real backend: the workspace geometry (stage + rail both on screen,
no ping-pong), the seek, the ⏱ anchor, the circled-frame comment (its frame on /api/yatsu/blob and the
thread's evidence[]), the anchor-chip seek, the @new dispatch, and the absence of verdict-filing controls
are all read from live surfaces (DOM, /api/issues) — never asserted from the component code. There is ONE
annotation primitive (an anchored comment on the eval's thread); the pane reads readings, it files none.
