---
scenarios:
  - name: latest-working-note-opens-execution-trace
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/execution-trace.e2e.mjs
    code: spec-dashboard/src/ExecutionTrace.jsx
    related:
      - spec-dashboard/src/TimelineChat.jsx
      - spec-dashboard/src/data.js
      - spec-dashboard/src/styles.css
    description: >-
      Through the running dashboard's real Sessions route, select Conversation for a live session, receive one
      normalized latest-working-note execution frame at the bottom of the conversation, read its shape against
      the rows above it, open its steps, replay a same-turn revision and a new turn, then replay a note equal
      to the newest agent message on the record.
    expected: >-
      The working note is the newest timeline row, drawn as agent prose on the page — no entry button, no card,
      no pop-out anywhere. Its normalized read and command rows are transcript-style tool sentences narrower
      than the column, carrying their familiar icons in chronological order; only the running one wears a
      running mark. Safe details start hidden; each row expands inline and independently, gaining height only
      for its own allowlisted detail. A same-turn update retains an expanded row, a changed turn starts its rows
      collapsed, an empty frame removes the tail, and a note the record already carries draws nothing. No
      transcript envelope, raw argument, sensitive input, or output is rendered by the browser. No page errors.
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
