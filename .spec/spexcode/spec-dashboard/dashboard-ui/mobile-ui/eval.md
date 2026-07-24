---
scenarios:
  - name: terminal-free-conversation
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport (≤ 640px), open the Sessions tab and tap a live worker. The detail is the
      terminal-free conversation ([[session-timeline]]): the timeline of the session's status transitions
      (timestamps + the FULL declaration note text) with the BARE composer docked below — no chips, no
      note-reply verbiage anywhere. Type a message and send it. Record the whole interaction as a video.
    expected: |
      The timeline renders the session's recorded status events oldest-first (colored status word + HH:MM
      time; a declaration's complete note shows as a block under its status line — not truncated to the
      board's 50-char cap). Sending appends a plain "you" event with the message text within one refresh;
      the draft clears on success. The agent actually RECEIVES the message (its record flips to working),
      and because every dispatch from this surface SILENTLY carries replyVia:"note" (the surface's fixed
      property — no visible control), its next declaration's full note — the reply — appears in the same
      timeline. No terminal is ever mounted.
  - name: terminal-free-composer-dock
    tags: [frontend-e2e, mobile]
    code: spec-dashboard/src/TimelineChat.jsx
    related: [spec-dashboard/src/MobileApp.jsx, spec-dashboard/src/styles.css]
    description: >
      Through the running dashboard in a real browser, at 375x667, 390x844, and the 640x360 mobile
      breakpoint, open a phone session detail, type a multi-word draft, and measure `.m-sessdetail`,
      `.m-main`, `.m-composer`, `.m-composer-line`, `.m-input`, `.m-send`, and the persistent
      safe-area-owning `.m-tabbar`. Screenshot each mobile layout.
    expected: |
      The TimelineChat composer ends exactly at both the session detail and `.m-main` bottoms, directly
      against the tab bar's top edge. Its input and send action remain aligned, enabled after typing,
      non-overlapping, and horizontally usable at every phone width. The tab bar keeps ownership of
      `safe-area-inset-bottom`, so navigation and home-bar clearance never move into the composer.
  - name: node-panes-one-axis
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport, drill to a node that declares eval scenarios (e.g. mobile-ui itself) and walk
      EVERY pane tab the node offers — spec, history, issues, eval, edit/children. Read (a) whether each
      tab renders real content (the eval tab must show the node's reading rows, not a blank host), and
      (b) whether ANY element inside the mobile shell scrolls horizontally (scan scrollWidth >
      clientWidth on elements whose overflow-x is auto/scroll — the history diff is the known offender).
    expected: |
      Every offered tab renders its pane — the eval tab shows the same reading timeline the desktop popup
      renders, never an empty pane host. NOTHING in the phone shell scrolls horizontally: the scan finds
      zero sideways scrollers on spec/history/eval/timeline surfaces — wide content (code blocks, diff
      lines, long paths) WRAPS instead, because a thumb surface scrolls one axis only.
  - name: session-detail-loading-string
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport (≤ 640px), open a session detail while its timeline request is still in
      flight (hold the /api/sessions/:id/timeline answer a few seconds to make the pending state
      observable). Read the text of the timeline's empty-state placeholder and screenshot it.
    expected: |
      The pending timeline reads the GENERIC loading word ("loading…" / 「加载中…」) — never another
      surface's loading phrase. In particular it must not say "loading specs from git…" (the graph
      HUD's boot string): a session conversation that claims to be loading specs misdescribes what
      is happening and reads as a wrong screen.
  - name: session-eval-on-phone
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport (≤ 640px), open a session detail. The header card carries a compact eval
      entry. Tap it and read location.hash + the rendered page: the tab bar's active entry, the gates
      strip, the row shapes, and whether anything scrolls horizontally. Open a row's detail page and
      read the column order; drive browser Back twice. Record the whole interaction as a video.
    expected: |
      The eval entry is a DOOR: it navigates to #/evals?session=<id> — the SAME session-scoped Evals
      list the desktop uses ([[session-eval]]), rendered by the shared routed pages inside the phone
      shell (the Evals tab lights): the gates strip renders, blind spots lead, ✦-marked own readings
      then the inherited baseline, one column, no horizontal scrolling. Opening a row lands on the
      worktree-rooted detail page reflowed to one column (side metadata first). Back returns to the
      scoped list, and Back again to the session conversation. The eval chunk loads lazily (only on
      first entry). A session with no worktree/diff shows the clean no-evaluation placeholder, never a
      blank page.
  - name: timeline-scroll-pinning
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport, open a session detail whose timeline overflows the screen several times
      over. It opens pinned to its newest entry. Scroll UP into history and stay there across at
      least one 8s poll cycle, sampling the container's scrollTop each second; record the whole
      run as a video.
    expected: |
      A reader parked in history is never yanked: across the poll the scrollTop holds where the
      thumb left it — the refetch must not move it, neither by swapping in an identical events
      array nor by an unconditional pin-on-render. Only a reader already AT the bottom follows new
      entries, chat style. The detail keeps the conversation bare — header (whose one extra control
      is the compact eval entry, [[session-eval]]), timeline, composer, no tab row above the
      timeline — so every in-flow line goes to the conversation itself.
  - name: timeline-interaction-refresh-stability
    tags: [frontend-e2e, mobile, desktop]
    code: spec-dashboard/src/TimelineChat.jsx
    related: [spec-dashboard/src/styles.css, spec-dashboard/src/MobileApp.jsx, spec-dashboard/src/SessionInterface.jsx]
    description: >
      Through the running dashboard in a real browser, open the SAME real headless session's
      TimelineChat at a 390x844 phone viewport and a 1280x800 desktop viewport. In each viewport,
      focus the composer, type an unsent multi-word draft, and hold through a timeline poll plus a
      board refresh. Then pointer-drag across the headless agent's note and keep the drag selection
      active while another refresh arrives; inspect activeElement and the textarea caret. Copy the selected
      text, then repeat the selection from a saved middle caret before pressing Backspace, Delete, ArrowLeft,
      Enter, Ctrl+V, and a printable key without directly targeting the textarea. Repeat with a plain click
      and a double-click. On desktop keep two headless sessions mounted, switch to the second, and repeat the
      selection/edit handoff there. Record the complete two-viewport interaction as video.
    expected: |
      Every refresh leaves the composer as document.activeElement and preserves the complete unsent
      draft. Note, sent-message, and reply copy is ordinary browser-selectable text: pointer drag and
      double-click produce a non-empty Selection whose text matches the rendered conversation. A
      refresh during that selection neither remounts TimelineChat nor clears or collapses the selection.
      A real selection retains document focus while it remains visible and copyable. The first subsequent
      editing or navigation key clears that external Range, focuses the exact conversation composer, restores
      its saved caret, and takes effect once through the textarea's native editing path. Backspace, Delete,
      ArrowLeft, Enter, Ctrl+V, and printable input therefore match their no-external-selection results; the
      textarea's DOM `selectionStart` agrees with the actual insertion/deletion point after every handoff. A
      plain click returns focus immediately with a collapsed Selection and its next key enters the draft.
      Existing click and double-click behavior elsewhere in the console still works. Only the active TimelineChat exposes
      `data-focus-sink`; with two warm desktop layers mounted, switching to the second makes its composer
      the sole sink and the press returns there, never to the hidden first draft. Phone and desktop satisfy
      the same interaction contract because both mount the shared TimelineChat.
  - name: create-session-entry
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport (≤ 640px), open the Sessions tab. Above the session list sits the create
      row — tap it: a full-screen composer opens (back chevron, prompt textarea, native launcher
      select, one launch button). Verify the select lists the SAME launcher profiles /api/settings
      serves and pre-selects the same default the desktop New tab would. Type
      `/tidy [[mobile-ui]] phone smoke`, tap launch, and observe the raw create request plus the fixture
      agent's expanded prompt while waiting through the button's busy state. Record the whole interaction
      as a video.
    expected: |
      The composer is the desktop New Session tab's touch twin with all substance shared (the one
      client launch path launch.js: raw prompt, launcher fetch + default resolution + the per-browser
      remembered pick, the one POST /api/sessions; backend newSession invokes /preset grammar for every
      caller). The POST carries raw `/tidy [[mobile-ui]] phone smoke`; the resulting row belongs to
      `mobile-ui`, while the fixture agent receives tidy's expanded body, target, and free text. The launch
      button reads busy while the backend
      builds worktree+agent (the double-tap guard), then the surface returns to the sessions list
      where the NEW session's row — the shared SessionRow face — appears within one board push. A
      failed create keeps the draft and shows a loud error in the composer.
  - name: sessions-tab-status-colour
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport (≤ 640px, where useIsMobile flips App to render MobileApp), tap the bottom
      Sessions tab. The list renders the ONE shared one-line SessionRow face (the same as the desktop
      console sidebar): status folded to an inline GLYPH, no avatar; tapping a session opens its detail,
      whose header shows the status WORD. With at least a couple of live sessions in different states,
      read the rendered colour (computed `color`) of each row's status glyph and of the opened detail's
      status word. Screenshot the sessions list and one detail.
    expected: |
      Every status mark — the glyph on each list row, the word in the opened detail header — is painted by
      its bucket hue from the single STATUS_COLOR map (four hues: working and parked green rgb(133,153,0);
      the waiting-on-you states asking/review/done yellow rgb(181,137,0); error red; the dormant rest
      idle/starting/queued/close-pending/offline muted grey rgb(147,161,161)) — the SAME colour the
      desktop surfaces show, never a flat uniform grey. No avatar and no status-word second line appears
      on any row: the retired two-row face must be nowhere to be found.
---

# mobile-ui — yatsu

Measure through the REAL phone-sized surface, YATU-style: shrink the viewport below 640px so App renders
MobileApp (the media query in [[mobile-ui]]'s `useIsMobile`), then drive the bottom tab bar and the session
rows as a thumb would and read the rendered colours — never an internal helper. The loss being scored is the
cross-surface status-colour contract owned by [[session-console]] (the single `STATUS_COLOR` map): a session's
state must read as the SAME hue on the phone as on the desktop board, so the mobile face never silently drifts
to a flat grey.
