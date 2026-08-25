---
scenarios:
  - name: one-conversation-dom-for-live-offline-and-archived
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx]
    description: >
      In a real browser open the Conversation face of a live session, an offline session, and an archived one; read
      the timeline body, the footer, and the composer's enabled/focusable state; send a multi-line message on the
      live one and read the rendered transcript.
    expected: >
      All three render the same timeline body and footer component; only the live footer's composer is enabled,
      the offline footer adds the read-only note and relaunch action, the archived footer adds its note and reads
      once without polling; the typed newline renders as a line break, not a reflowed wrap.
---
# measuring conversation

Three lifecycle states, one DOM: the measurement compares components, not screenshots of similar-looking panes.
