---
scenarios:
  - name: terminal-free-conversation
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport (≤ 640px), open the Sessions tab and tap a live worker. The detail is the
      terminal-free conversation ([[session-timeline]]): the timeline of the session's status transitions
      (timestamps + the FULL declaration note text) with the composer docked below, note-reply chip ON by
      default. Type a message and send it. Record the whole interaction as a video.
    expected: |
      The timeline renders the session's recorded status events oldest-first (colored status word + HH:MM
      time; a declaration's complete note shows as a block under its status line — not truncated to the
      board's 50-char cap). Sending appends a "you" event with the message text and an "↩ note" tag within
      one refresh; the draft clears on success. The agent actually RECEIVES the message (its record flips
      to working), and because the dispatch carried replyVia:"note", its next declaration's full note —
      the reply — appears in the same timeline. No terminal is ever mounted.
  - name: sessions-tab-status-colour
    tags: [frontend-e2e, mobile]
    description: >
      On a PHONE viewport (≤ 640px, where useIsMobile flips App to render MobileApp), tap the bottom
      Sessions tab. The list reuses the shared SessionRow face, so each row shows the session's status
      WORD; tapping a session opens its detail (the m-sess-status word, the activity line, the changing
      nodes). With at least a couple of live sessions in different states, read each status word's RENDERED
      colour (computed `color`) on the list rows and in the opened detail. Screenshot the sessions list and
      one detail.
    expected: |
      Every status word — on the list rows and in the opened detail — is painted by its bucket hue from the
      single STATUS_COLOR map (four hues: working and parked green rgb(133,153,0); the waiting-on-you states
      asking/review/done yellow rgb(181,137,0); error red; the dormant rest
      idle/starting/queued/close-pending/offline muted grey rgb(147,161,161)) — the SAME colour the
      desktop surfaces show, never a flat uniform grey.
---

# mobile-ui — yatsu

Measure through the REAL phone-sized surface, YATU-style: shrink the viewport below 640px so App renders
MobileApp (the media query in [[mobile-ui]]'s `useIsMobile`), then drive the bottom tab bar and the session
rows as a thumb would and read the rendered colours — never an internal helper. The loss being scored is the
cross-surface status-colour contract owned by [[session-console]] (the single `STATUS_COLOR` map): a session's
state must read as the SAME hue on the phone as on the desktop board, so the mobile face never silently drifts
to a flat grey.
