---
scenarios:
  - name: terminal-free-conversation
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport (≤ 640px), open the Sessions tab and tap a live worker. The detail is the
      terminal-free conversation ([[session-timeline]]): the timeline of the session's status transitions
      (timestamps + the FULL declaration note text) with the BARE composer docked below — no chips, no
      mode controls, no note-reply verbiage anywhere. Type a message and send it. Record the whole
      interaction as a video.
    expected: |
      The timeline renders the session's recorded status events oldest-first (colored status word + HH:MM
      time; a declaration's complete note shows as a block under its status line — not truncated to the
      board's 50-char cap). Sending appends a plain "you" event with the message text within one refresh;
      the draft clears on success. The agent actually RECEIVES the message (its record flips to working),
      and because every dispatch from this surface SILENTLY carries replyVia:"note" (the surface's fixed
      property — no visible control), its next declaration's full note — the reply — appears in the same
      timeline. No terminal is ever mounted.
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
      entries, chat style. The detail is the bare conversation — header, timeline, composer, no
      tab row above the timeline (changed-nodes review is desktop scope) — so the freed line goes
      to the conversation itself.
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
