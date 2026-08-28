---
scenarios:
  - name: the-open-seam-is-the-live-tail
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/live-tail.e2e.mjs
    code: packages/transcript-ui/src/LiveTail.tsx
    related:
      - spec-dashboard/src/Transcript.jsx
      - spec-dashboard/src/TimelineChat.jsx
      - spec-dashboard/src/data.js
      - spec-dashboard/src/styles.css
    description: >-
      Through the running dashboard's real Sessions route, select Conversation for a working session and feed
      the open seam's transcript stream the wire's frames — one `full`, then `delta`s carrying only the turns
      that changed, tool results as `output: null` with a tool route answering the body: a human message, prose,
      a completed call and a running one; the running call's completion; a later prose turn; a turn with tools and no prose; a
      trailing run of seven calls across five tool-only turns with no prose, one turn firing three calls at
      once, behind a human turn the record does not carry; the prose that answers that run; then prose equal
      to the newest agent message on the record. Between frames, expand and collapse the seam.
    expected: >-
      The tail sits inside the open seam's row beneath its live line — no trace row, no card, no pop-out — and
      the seam's turn and call counts come from the same payload. The newest prose is agent prose on the page;
      each call is a transcript sentence narrower than the column, only the result-less one wearing the running
      mark; output stays folded until clicked and opens inline, its body arriving by one fetch for that call
      that a later delta does not repeat; a delta leaves the untouched turns exactly where the full frame put
      them. The caret blinks inline at the end of the
      newest prose's last line only while that prose is the turn's newest event — never on a line of its own,
      and not at all once a call follows the words. A same-interval refresh keeps the open row and
      drops the settled call's running mark; a later prose turn replaces the compact view with that prose and
      the calls after it; a prose-less turn still shows its calls. Expanding the seam shows the whole interval
      from the payload already held — every prose turn, the still-running call, no loading line — and the
      compact face leaves; collapsing brings it back. The interval never quotes the message that opened the
      seam (it is on the record one row above), while the human turn the record does not carry is quoted.
      Work in progress never folds: the trailing run draws all seven calls as sentences in the collapsed face
      and in the expanded interval alike, with no `N tool uses` row in either, at one even list spacing
      across the turn boundaries; the moment the agent answers, the tail is that prose alone and the expanded
      interval folds the seven calls behind it. Prose the record already carries, with nothing running, draws
      nothing. No page errors.
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
