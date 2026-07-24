---
scenarios:
  - name: conversation-is-the-only-headless-console
    tags: [frontend-e2e, desktop, mobile]
    description: >-
      Through the running worktree dashboard in a real browser, open a real headless session at desktop and
      phone widths. Inspect the complete visible console, then exercise conversation text selection/copy,
      retain an unsent composer draft across a timeline refresh, and switch away and back on desktop. Capture
      the settled conversation as a static screenshot.
    expected: >-
      The only terminal-free console is TimelineChat: one conversation timeline plus its composer, with no
      complete-process door, native-message view, xterm, or terminal placeholder at either viewport. Existing
      conversation behavior remains intact: text selects and copies, the focused desktop composer keeps its
      draft through refresh and tab switches, and phone entry does not summon keyboard focus.
    test: spec-dashboard/test/timeline-chat-interaction.e2e.mjs
    code: spec-dashboard/src/TimelineChat.jsx
    related:
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/styles.css
---

Measure through the real Sessions route and a real headless worker. Source inspection can confirm deletion, but
only the rendered conversation and its browser interactions prove that subtraction preserved the console.
