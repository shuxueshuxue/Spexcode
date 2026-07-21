---
scenarios:
  - name: detail-page-grammar
    tags: [frontend-e2e, desktop]
    description: >
      Open a video reading's detail page (#/evals/<node>/<scenario>) whose thread holds several anchored
      remarks. Read the page's skeleton: the header (scenario title + node), the status band (verdict
      badge + A/B strip), the main column's order (evidence workspace, then the remark thread), the side
      rail's metadata sections, and the composer's geometry (getBoundingClientRect on `.ds-compose` and
      its textarea) WITHOUT scrolling. Scroll the thread and re-read whether the composer stayed on
      screen; type into it and read whether the page scrolled. Then narrow the window under the phone
      breakpoint and read the column order.
    expected: |
      The detail wears GitHub's issue-page grammar through the shared DetailShell: header → status band →
      MAIN column (the evidence workspace, then the remark thread as the page's activity) beside the
      metadata SIDE rail. The composer is DOCKED STICKY at the main column's foot — on screen immediately
      and staying on screen while the thread scrolls behind it, so circle→remark→circle never buries the
      writer. NO fold strip exists; the header leads with the ONE compact back anchor — a real `<a href>`
      (never a history.back button) whose destination derives from the canonical address. Under the phone
      breakpoint the SAME markup reflows to one column with the side metadata FIRST, the composer still
      reachable at the foot.
  - name: mark-lands-in-docked-composer
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EventDetail.jsx]
    description: >
      On a video reading's detail page: drag-circle a region on the paused frame and read the docked
      composer (prefill + focus). Then click a scrubber comment marker and read which thread remark
      selected/highlighted. Press ↑/↓ and read the selection walk. Navigate to another eval's page and
      read the composer's draft.
    expected: |
      A drag-circle (or `a`) pauses the clip, captures the frame, and PREFILLS the docked composer with
      the anchored draft (`▶m:ss · step` + the frame link), focusing it — no unfold step exists, the
      composer is already on screen. Clicking a scrubber marker selects+seeks its remark and the thread
      row highlights in sync; ↑/↓ walk the anchored remarks. A different eval's page starts with a FRESH
      composer — a half-typed or prefilled draft dies with its page, never leaking onto another
      scenario's thread.
  - name: stale-reading-readout
    tags: [frontend-e2e]
    description: >
      Open the detail page of a reading whose node's governed code changed after it was taken (a
      code-stale reading — the muted shared verdict icon in the list). Read the side rail: is there a stale readout
      naming the moved axes, and for the code axis the drifted file(s) + how many commits behind? Then
      confirm the remark composer works on it exactly as on a fresh reading (type + send a remark).
    expected: |
      A non-fresh viewed reading shows a stale readout in the side rail: the freshness axes that moved
      (e.g. `code · scenario`), and for the code axis the drifted governed file(s) with a commits-behind
      count (e.g. `EvalsFeed.jsx +3`). A fresh reading shows NO readout. The readout is reporting only —
      flipping A/B re-renders it for the viewed reading. The remark composer is unaffected by
      freshness: a remark is authored and sent on a stale reading identically to a fresh one.
  - name: annotate-seek-circle-file
    tags: [frontend-e2e]
    description: >
      Open the detail page of a video reading (carrying a step-timeline sidecar, its thread holding
      anchored comments). On the MEDIA STAGE, over the CUSTOM review-track
      player: read the scrubber's comment markers + step bands + duration; click a comment marker and read
      video.currentTime + which comment/marker highlights (the comment lives in the RIGHT RAIL);
      play/pause and read the playhead-active thread comment as it advances; frame-step with '.' and jump
      comments with ↑/↓ and read video.currentTime; press 'a' and read the docked composer's stamped anchor;
      click a step on the ruler; drag on the paused frame to circle a region, read the prefilled composer
      and send it; click the sent comment's anchor chip; read the pane's DOM for any verdict-filing
      controls (pass/fail buttons, a note input, a file-reading action); switch selection to another row
      and back.
    expected: |
      The eval detail IS the event detail — a full-height workspace, no modal — with a CUSTOM player
      (native chrome replaced) on the stage: a scrubber carrying the play-fill + knob, one MARKER per
      anchored comment at its moment, and step BANDS from the timeline; a live time readout + a chip
      naming the step the playhead is in. Clicking a marker SEEKS to that comment (the blob route answers
      byte ranges — without them the browser clamps to 0) AND selects it: the marker and the thread comment
      both highlight, in sync. As the clip plays the playhead-ACTIVE comment lights and the step chip
      flips at each boundary. The keyboard drives it — space play/pause, ←→ ±5s (⇧ 1s), , . frame-fine,
      ↑↓ jump to the prev/next comment (seek + select), 'a' stamps a `▶m:ss · <step>` anchor into the
      docked composer (+ a `[[node]]` line when the step routes elsewhere) and focuses it. The
      named-step ruler still click-seeks. A drag circles a region: the paused frame (rect burned in) is
      POSTed to /api/evidence and the composer is prefilled with an anchored comment — the anchor line,
      a `![frame](/api/evidence/<hash>)` link, and the routing line — with the stage still on screen.
      Sending it creates/appends the eval's local Issue thread ('eval: <node> · <scenario>') with that
      frame in the body AND on the thread's typed evidence[]; the sent comment shows an anchor chip that
      SEEKS + selects on click and renders the circled frame inline. '@new' dispatches a fresh worker
      with the anchor in its prompt. The pane carries NO verdict-filing controls — no pass/fail bar, no
      verdict-note input, no file-reading button (readings are filed by agents via `spex eval add`; the
      human judges through the remark composer). Switching selection resets the working draft.
  - name: no-instructional-caption
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EventDetail.jsx]
    description: >
      Open a VIDEO reading's detail page (#/evals/<node>/<scenario>). Read the DOM of the evidence
      workspace UNDER the custom review-track player: is there any always-visible instructional caption
      strip — a usage-hint line ('.an-hint' carrying "click the frame to play/pause…") or a
      keyboard-shortcut legend ('.an-keys', "space play/pause · ←→ 5s…")? Scan the whole rendered page for
      that baked hint text. Confirm the player itself is intact: the '.an-player' wrapper, the '.an-seek'
      scrubber, the step ruler, and playback (press Space).
    expected: |
      The evidence workspace renders NO always-visible instructional caption strip under the player: no
      '.an-keys' legend and no usage-hint '.an-hint' line exist under a video reading (the '.an-hint'
      class survives only as the no-evidence sentinel elsewhere), and neither the "click the frame to
      play/pause…" nor the "space play/pause…" text appears anywhere on the page — so a captured frame or
      screenshot of the stage carries only the reading, never baked-in hint text. The restraint matches the
      docked composer's own no-hint-line decision. The keyboard-driven surface is unchanged: the custom
      player, its scrubber + markers + step ruler render and playback still works — the affordances are
      self-evident, they are simply no longer captioned on screen.
  - name: anchor-carries-frame
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EventDetail.jsx, spec-dashboard/src/Thread.jsx]
    description: >
      On a video reading's detail workspace, make one mark per gesture: drag-circle a region on the paused
      frame, stamp an anchor with the composer's ⏱ button (type a note, send), and press 'a'. Read each
      prefilled/stamped composer draft and, after sending, read the review track's rows (anchor chip,
      prose, media count) and screenshot the thread.
    expected: |
      Every anchored mark carries the FRAME of its moment, whichever gesture made it: the circle burns its
      rect into the captured frame; ⏱ and 'a' capture the clean current frame — all three stamp
      `▶m:ss · step` plus a `![frame](/api/evidence/<hash>)` link (the frame doubling as the remark's
      typed evidence[]). Re-stamping ⏱ at a new moment replaces both the anchor line AND its riding frame,
      so an anchor and its frame never disagree. In the track every anchored remark renders uniformly —
      chip + frame thumbnail (+ prose) — a ⏱/'a' remark is indistinguishable in shape from a circle
      remark. A failed capture degrades to the text-only anchor (the capture flash reports it), never a
      blocked mark.
  - name: fullscreen-control-present
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EventDetail.jsx, spec-dashboard/src/Evidence.jsx]
    description: >
      Open a VIDEO reading's detail page. On the MEDIA STAGE, read the custom player's
      control bar (`.an-bar`): does it carry a fullscreen control (`.an-fs`) alongside play/pause · scrubber
      · time? Read the button's glyph (must NOT be an emoji — an inline SVG icon) and its title/aria-label.
      Click it and read `document.fullscreenElement` — is it the player wrapper (`.an-player`, so the custom
      scrubber/controls are still on screen), not just the bare `<video>`? Read the button's title again
      (should flip to an exit label). Exit fullscreen (Esc) and confirm the element clears. Separately, on a
      plain `<video controls>` home (a node eval-tab gallery clip, or a thread blob link) confirm NO extra
      `.an-fs` is added — native controls already carry fullscreen (no doubled control).
    expected: |
      The custom review-track player — which SUPPRESSES native `<video>` chrome — carries an explicit
      fullscreen control in its bar (`.an-fs`), rendered as an inline corner-bracket SVG (house icon style),
      NO emoji glyph, with a 'fullscreen' title/aria-label. Clicking it calls requestFullscreen on the whole
      player wrapper (`.an-player` = stage + control bar), so in fullscreen the video fills the screen AND
      the custom scrubber/markers/time stay usable (keyboard scrubbing still drives it); the title flips to
      'exit fullscreen' and the icon to the inward-bracket variant. Esc exits and `document.fullscreenElement`
      clears. It is the ONE shared FullscreenButton (from Evidence.jsx), used ONLY where controls are
      suppressed: a plain `<video controls>` gets fullscreen from its own native chrome and grows NO second
      control — the fullscreen affordance is present on every video surface, never duplicated.
  - name: image-lightbox
    tags: [frontend-e2e]
    description: >
      Open an IMAGE reading's detail page: read the image's cursor style, click it,
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
      Open the detail page of an eval with no existing remark thread:
      send a first comment; send a second; confirm the trunk store holds exactly ONE local issue for that
      concern — read it from the board overlay's `entry.thread` (or the store's git log), since
      /api/issues excludes eval concerns by construction — and that no row for it renders on #/issues;
      send a third containing '@new'. Read the overlay between sends.
    expected: |
      The first comment lazily CREATES a local issue bound by concern 'eval: <node> · <scenario>'
      (nodes:[node], the comment its first reply) and it renders in place in the thread. The
      second comment APPENDS to that same thread — the store holds exactly ONE local issue with that
      concern (no duplicate thread), now with two replies, both carried by the board overlay's
      `entry.thread`. The thread IS a real local issue (store local, concern-keyed) but — after the
      eval-remark read-time split — it is EXCLUDED from the merged issue list server-side (/api/issues'
      mergedIssues drops isEvalConcern); it surfaces only under its eval, never as an Issues-page row.
      The '@new' comment dispatches a fresh worker through the same write path — the one-line outcome
      ('@ new→<session>') echoes on the page.
  - name: composer-trigger-buttons
    tags: [frontend-e2e]
    code: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/mentions.jsx]
    description: >-
      Open a reading's detail page. In the docked composer's action row read the
      `@`, `[[`, and `/` symbol buttons (aria-labels/tooltips). Seed a draft, place the caret mid-draft,
      click `@` and read the textarea's value/focus/selectionStart and any open menu; Esc, select a span,
      click `[[` and re-read; Esc, put the caret at a line start, click `/`, and read the review menu.
      Confirm no remark was posted, then re-read the row's child geometry at desktop and at a ~780px
      window. Open an issue reply composer and confirm its action row still has only the reference buttons.
    expected: >-
      The shared Thread composer carries `@` and `[[` discoverability buttons on every home; the eval composer,
      which supplies review commands, adds the compact `/` button while an issue composer does not. Each
      inserts its EXACT trigger at the caret/selection, preserves the rest of the draft, and refocuses with
      the caret right after the trigger. The ONE shared autocomplete opens upward for `@`/`[[`; from a
      command-eligible line start `/` opens the ONE shared review menu. No second menu, dispatch, or post.
      Localized aria-label + shared `data-tip` on all applicable buttons. At desktop and ~780px the row
      (triggers, ⏱ where a clip supplies one, Send) fits without overlap. No page errors.
  - name: ab-history-flip
    tags: [frontend-e2e]
    description: >
      Open the detail page of a scenario that has MORE THAN ONE reading — a fail (A) followed by a pass (B). In
      the detail workspace's HEADER band, read the A/B strip's verdict pips and the position label; click
      the older (fail) pip (or press ‹) and read the header verdict badge, the expected/note text, and
      which evidence blob the media points at; then click the newest (pass) pip and read them again. Read
      the remark thread before and after the flips.
    expected: |
      The A/B strip rides the slim header band (right-aligned), one shared verdict-state SVG per reading,
      oldest→newest, fail for an A pole and pass for a B pole, the viewed button outlined. The icon, accessible
      label, and tone are the SAME mapping consumed by the Evals list and detail status. Flipping to the older
      reading lights its fail state, updates the header to the same fail visual, and swaps the media/expected/
      note IN PLACE to that reading's (a different blob hash than the latest); flipping back to the newest
      lights pass in both selector and header, restores the latest media,
      and the position label reads 'latest'. The strip is absent for a single-reading scenario. The eval's
      remark thread (bound by concern 'eval: <node> · <scenario>') is IDENTICAL across both flips — it is
      per-scenario, not per-reading, so the annotation track spans the whole A/B.
  - name: media-intrinsic-geometry
    tags: [frontend-e2e]
    code: [spec-dashboard/src/Evidence.jsx, spec-dashboard/src/styles.css]
    description: >
      Open detail pages whose readings carry a TINY (e.g. ~160px), a MEDIUM, and an OVERSIZED
      (wider than the main column) image and video, at a 1440px and a 390px viewport, in light and dark
      themes. For each media element compare its rendered box (getBoundingClientRect) against its
      intrinsic size (naturalWidth/videoWidth), read the main column's available width, and check
      document.documentElement/scrollWidth for horizontal overflow. On the clip, confirm the custom
      review-track bar and timeline still render and drive the video.
    expected: |
      Media renders at INTRINSIC geometry, shrink-only: a tiny image/clip renders at its native pixel
      size — never stretched to the column width by the stage, the gallery's layout, or a reply's media
      list; an oversized one scales DOWN proportionally to exactly the main column's available width
      (aspect ratio kept); at 390px the same law holds and nothing widens the page (no horizontal
      scrollbar at any viewport). The shrunk clip keeps its full custom controls: the player chrome
      shrink-wraps the clip rather than stretching the clip, and scrubber/step-rail/keyboard still work.
      Both themes render the same geometry.
  - name: ab-strip-bounded
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EventDetail.jsx]
    description: >
      Open the detail page of a scenario with a HUNDREDS-deep synthetic reading history. Measure the
      status band's height and whether the A/B strip stays one line; count the rendered pips; open the
      overflow control with mouse and keyboard (Arrow/Home/End roving, Esc restore) and read its rows'
      icons/labels; pick an old reading from the menu and re-measure the band height, the selected pip,
      and the position label; walk ‹ › across the window edge; repeat at 390px.
    expected: |
      The strip is ONE line at a stable height however many readings exist: at most eight recent readings
      render as pips (the shared verdict visual, oldest→newest), plus the chevrons, position label, and
      ONE overflow trigger. Every reading not holding a pip lives in the single accessible overflow menu —
      menuitemradio rows wearing the same shared ReviewState visual + position + filed time, keyboard
      roving, Esc restoring the trigger. Picking an old reading views it IN PLACE: the viewed reading
      always holds a visible pip (when older than the recent window it takes the window's leftmost slot,
      clearly selected), the band's height does not change, and the chevrons still walk the WHOLE history
      one step at a time. No reading is unreachable; no wrap ever grows the band. At 390px the strip still
      fits without widening the page.
  - name: originator-liveness-shown
    tags: [frontend-e2e]
    code: spec-dashboard/src/EventDetail.jsx
    description: >
      On the detail page of a video reading whose LATEST reading carries a `by` (the session that filed
      it) that is an ONLINE board session, read the SIDE rail's filer pill
      (`.fv-originator`): the originator id, its alive/offline class, the dot's computed colour, and the
      title (which must read as an EVAL, not an issue), whether the ONLINE filer is a click target, and
      whether the old reach phrase is absent. Confirm a reading with no `by` (a legacy reading) shows no
      filer chip.
    expected: |
      The side rail surfaces the FILER — the session that filed the viewed scenario's latest reading (from
      `evalTimeline`'s per-reading `by`) — with a liveness dot and no visible reach phrase: an ONLINE filer
      reads `alive`, uses a status-hued dot from the board's `STATUS_COLOR`, renders as a clickable chip,
      and clicking it opens `#/sessions/<id>` with that session selected. An absent/offline filer reads
      `offline`, uses the muted dot, and is not clickable. The title names it an EVAL, the same shared
      `OriginatorLiveness` the issues detail uses, distinct only in wording. A legacy reading with no `by`
      resolves to nobody and the rail simply shows no filer chip. No second palette, no page errors.
  - name: remark-resolve-retract
    tags: [frontend-e2e]
    code: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/EventDetail.jsx]
    description: >-
      Against a backend on a disposable store, seed one AGENT-authored remark (CLI `spex remark`, a real
      session id) and one HUMAN-authored remark (POST /api/remarks) on the SAME (node, scenario). Open
      that scenario's detail page, and read the thread's remark rows: which verb button each
      carries. Click resolve on the agent's remark and re-read its row; click retract on the human's own
      and re-read the thread.
    expected: >-
      Each unresolved remark row carries exactly ONE verb, mirroring the server's teeth: the agent's
      remark a `resolve` button (the human's second-party judgment — never offered on the human's own),
      the human's own a `retract`. Resolve flips the row in place to settled (dimmed, "✓ resolved", the
      resolver in its title) and the verb disappears — monotonic, a resolved remark is immutable. Retract
      REMOVES the human's own row from the thread. Both writes ride the CLI-parity
      /api/remarks/resolve|retract with the `<thread-id>#<rid>` ref in the BODY; a refused action
      surfaces its server message on the row, never swallowed. No page errors.
  - name: session-home-history-rooted
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EventDetail.jsx, spec-dashboard/src/EvalsPage.jsx]
    description: >-
      In a real browser open the SESSION-scoped detail page (#/evals/<node>/<scenario>?session=<id>) for
      a session whose worktree has
      filed an in-session VIDEO reading on a scenario the MAIN checkout still scores with an OLDER,
      different reading (e.g. an image). Read
      the page: how many <video> elements mount (`.an-video`); whether the media shown is the in-session
      video or the older main-checkout still; whether the A/B strip's newer (›) control can reach the
      current reading. Contrast with the same scenario's UN-scoped page (main-rooted).
    expected: |-
      The session scope is WORKTREE-rooted end to end: the in-session video reading's page opens THAT
      reading — its <video> mounts on the stage (`.an-video` present, video count ≥ 1) and the A/B strip
      shows the in-session reading as the latest (the › newer control disabled AT it, not short of it).
      The detail is NEVER the older main-checkout reading: the pane must not re-fetch the main
      `/api/specs/:id/evals` timeline (which lacks the un-merged in-session reading) and strand the
      current video behind an inherited still with the newer-nav disabled. The A/B history is
      scope-provided — the session-scoped page hands EventDetail its already-computed worktree readings,
      so the walk reflects the session's branch; the un-scoped page (main-rooted) still fetches its own
      timeline.
  - name: data-folds-under-media
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/Evidence.jsx, spec-dashboard/src/EventDetail.jsx]
    description: >-
      Select a reading carrying BOTH a clip/still AND a structured `data` entry (a vid·img·data reading). On
      the detail stage read the data block: is it FOLDED behind its labelled header by default, with the JSON
      HIDDEN (checkVisibility=false) until the header is clicked — then shown? Then compare a data-ONLY
      reading's block.
    expected: |-
      When the reading also carries primary media (video/still), the structured `data` renders as a native
      <details> FOLDED to just its "STRUCTURED DATA (JSON)" header (a ▸ marker), the JSON hidden
      (checkVisibility=false) so it never pushes the clip/gallery off the stage; clicking the header opens it
      (▾ + the pretty-printed block). A data-ONLY reading renders the block OPEN (it IS the evidence). Only
      the `data` kind folds — a transcript is unaffected — and the fold is native HTML, no JS state.
  - name: composer-shared-shape
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/EventDetail.jsx]
    description: >-
      In a real browser, open a video reading's eval detail page; then an open local issue's detail page.
      On BOTH composers read the rendered DOM and computed
      styles: the `.fv-compose` container's border/radius, the textarea's computed border-style and idle
      height, the action row's idle presence and contents (every control's accessible name), whether any
      always-visible hint text renders, and — on the eval detail — whether the status band carries any
      human-ok WRITE button. Type `@` and `/` and read where the menus open relative to the composer.
      Repeat both pages at a NARROW desktop width (~780px — under the shell's one-column reflow) and
      check for overlap or clipped text around the composer.
    expected: >-
      ONE shared composer shape on both pages: a quiet bordered rounded container holding a BORDERLESS
      writing surface (computed border-style none) floored at TWO lines idle (~40px, never a one-line
      sliver), over a PERSISTENT compact action row. The row carries only real SpexCode acts — the
      `@`/`[[` trigger-insert buttons ([[mentions]] discoverability, on every home), the `/` trigger on
      the eval composer where review commands are armed, ⏱ anchor on that clip composer, Promote/Close
      issue on an open issue — and an ICON-ONLY Send
      (an SVG glyph with an aria-label/tooltip, no bare unlabeled icon) pinned at the row's right edge;
      none of the reference app's tools (attach, web, model pickers …) appear. NO always-visible hint
      line ('@session to summon · [[node]] to link' is gone) — while the `@`/`[[` autocomplete and the
      `/` command menu still open, as overlays ABOVE the composer container, never inside or under it.
      The eval status band carries NO standalone human-ok button — the typed /ok is the only dashboard
      door, and an ok'd reading shows only the settled shared circle-check SVG mark. At the narrow width both composers keep
      the same shape with no overlapping controls and no clipped text. No page errors.
---
# event-detail loss

YATU through the real browser over a real backend: the detail page's GitHub grammar (main column + side
rail, sticky docked composer), the seek, the ⏱ anchor, the circled-frame comment (its frame on
/api/evidence and the thread's evidence[]), the anchor-chip seek, the @new dispatch, and the absence of
verdict-filing controls are all read from live surfaces (DOM, /api/issues) — never asserted from the
component code. There is ONE annotation primitive (an anchored comment on the eval's thread); the pane
reads readings, it files none.
