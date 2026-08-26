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
  - name: the-transcript-reads-as-a-conversation
    tags: [frontend-e2e, desktop]
    description: >-
      Open a real session's transcript in a real browser — one with actual tool traffic, found by asking the
      transcript API for a range that contains tool calls rather than by opening the newest phase, which is
      often pure prose and proves nothing. Read the shape: how many bubbles and how wide, where they sit
      against the flow's edges, the prose measure, how many tool rows there are and how many of them are
      narrower than their container, and whether any old nested-log chrome survives. Then open the work fold
      and count the tool rows again. LOOK at the screenshot too — the numbers here all passed while the
      column still ran the full pane and the exchange read as two columns of a table.
    expected: >-
      The person's turn is a bubble set against one side and capped well under the measure; the agent's turn
      is full measure with no bubble. Prose holds a readable measure however wide the pane. Every tool row is
      narrower than its container — a sentence, not a card — and none carries a success mark, because the
      record has no per-tool status to report. The work that produced the answer arrives FOLDED to one line
      naming its count and kinds, and opening it reveals every call it stood for. Zero loss = the reader sees
      the answer and one line about what it cost, and reaches the rest in one click.
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/src/toolVocabulary.js]
---
# measuring conversation

Three lifecycle states, one DOM: the measurement compares components, not screenshots of similar-looking panes.
