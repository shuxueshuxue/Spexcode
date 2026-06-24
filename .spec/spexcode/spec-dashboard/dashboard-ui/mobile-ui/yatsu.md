---
scenarios:
  - name: sessions-tab-status-colour
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
