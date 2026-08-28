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
  - name: the-status-machine-leaves-the-reading-unit
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx]
    description: >-
      In a real browser open the Conversation of a real session whose timeline holds many bare `working`
      events, peer messages carrying the `spex session send` envelope, and a terminal `error`. Read the API
      timeline beside the DOM and count: bare `working` events versus rendered seam rows; disclosure buttons
      outside any opened inset; message rows whose gutter time sits left of the content cell; text elements
      (times, button labels) touching the column's right edge; the widest agent note and the widest quote;
      envelope phrases in the rendered text. Read every seam's lead and the error line's text. Open the
      newest seam that holds tool traffic and count the inset's tool rows. Repeat the desktop read in a light
      preset, then at 390px wide count visible gutters and inline times. LOOK at the screenshots: the
      numbers can pass while the page still reads as a machine log.
    expected: >-
      Each run of bare `working` events is one seam row and one disclosure — no per-event rows, no
      `working 1s / 11s / 4m 30s` stacks. Every message row's time is in the left gutter, left of the
      content cell, and nothing textual touches the right edge. Agent notes run the 720px measure; quotes cap
      at 80% of it, flush right. Zero envelope phrases render although the API text carries them. Every closed
      seam reads `worked <span>` with a thin chevron trailing it and no dot in its gutter; the error line carries no duration. The opened seam shows its transcript
      inset with tool rows beneath it. At 390px no gutter is visible and every message row carries an inline
      time. The light preset changes only colour, not shape.
  - name: the-conversation-reads-as-paper
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/src/styles.css]
    description: >-
      In a real browser open a live session's Conversation at 1440px, at a 760px window, and in the 390px
      phone shell. Read the column's width and centring, the widest agent note against the column, the widest
      quote against the column, the resting opacity of a row's gutter time and its opacity under hover, the
      seam row's font size, whether any rule runs from it to the edge and whether its chevron trails the
      words (as the tool rows' and work folds' do), the vertical air between rows, and
      the timeline's side padding at each width. LOOK at settled screenshots beside the before images.
    expected: >-
      One 720px measure, centred, that notes fill and quotes cap at 80% of; gutter time rests below full
      opacity and comes up on hover; the seam is one caption-sized line with no rule to the edge and its
      chevron last, after the words, like every other disclosure on the page; rows sit at
      least 12px apart; side margin grows with the pane and shrinks to 14px under the 560px threshold. The
      ground is the theme's paper, dark preset included. No page errors.
  - name: a-native-selection-does-not-outlive-the-next-press
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx]
    description: >-
      In a real browser open a real session's Conversation and click one word of an agent note four times in
      quick succession (detail 1..4 — the fourth is the click the custom selection did not claim, so the
      browser itself selected the paragraph). Read `getSelection().toString()` and the `timeline-sel`
      highlight. Then single-click another word of the same note, twice, reading both again, and LOOK at the
      screenshot: the bug is a paragraph that stays painted after every click. Also confirm the ordinary
      path still works — a plain drag paints the custom highlight with no document Selection, and one plain
      click clears it.
    expected: >-
      After the plain click nothing is painted: the document Selection reads empty and the highlight is gone.
      A press the timeline owns retires both kinds of selection, so no native selection that leaked in —
      from a fourth click, a drag begun on a control — can survive the next click. The drag control case is
      unchanged: custom highlight, no document Selection, cleared by one click.
  - name: the-composer-is-paper-with-one-send-mark
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/test/explorer-collapse-folders.e2e.mjs]
    description: >-
      In a real browser open a live session's Conversation at 1440px, at a 760px window (the pane under the
      560px container threshold), and in the 390px phone shell. Read the composer's frame, its width against
      the reading column, and its send control: element kind, accessible name, size, enabled state before and
      after typing. Intercept the send request at the network edge, send a two-line message with Enter, and
      read the request body and the draft afterwards. LOOK at the screenshots.
    expected: >-
      One composer card on the page's own paper with a hairline frame, no wider than the 720px column and
      centred on the pane at every width; its send is the shared icon-only mark with a tooltip and an
      aria-label, disabled while the draft is empty and enabled once it is not. Enter posts `kind:text` with
      `replyVia:note` and the typed text, and clears the draft on success. At 760px the gutter is gone and
      times are inline; at 390px the composer sits above the tab bar. No page errors.
  - name: stop-is-one-square-while-working
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/test/explorer-collapse-folders.e2e.mjs]
    description: >-
      In a real browser open the Conversation of a session that is `working` and of one that is `asking`.
      Read the composer line of each: what sits beside send, its element kind, accessible name, size and
      position. Intercept the interrupt request at the network edge and press stop on the working one.
    expected: >-
      The working session's composer carries one stop square left of send — a BUTTON with a tooltip and an
      aria-label, the same 26px square as send — and pressing it posts exactly one interrupt for that session
      through the one verb. The asking session's composer carries no stop control at all. No page errors.
  - name: a-working-agent-always-ends-with-an-open-seam
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/test/conversation-working-tail.e2e.mjs]
    description: >-
      In a real browser open the Conversation of fixture sessions whose timelines are the shapes the status
      machine really writes: a message into an awaiting session followed by its `active` event; a SECOND
      message into the now-active session, which leaves no status event behind; a message into a working
      agent that later asks; an `active` event carrying a note, then asking; a peer message into an asking
      session; an error, a message, and the re-entry; and an offline record whose last word is working. Read
      the rows after the prompt in order — seam (live or closed, its lead), message, say, line — and click
      the live tail to open it.
    expected: >-
      Whenever the session is working, the last row is one live seam reading `working · <duration>` that
      opens on click; a seam sits after every message or note that landed on a working agent, mid-history
      as well as at the tail, so no stretch of work is left without its disclosure. A message that lands on
      an agent that is not working claims no seam; an error line carries none before it; the offline
      record's tail reads the bare word `working`. The shapes that were already right render exactly as
      before.
---
# measuring conversation

Three lifecycle states, one DOM: the measurement compares components, not screenshots of similar-looking panes.
