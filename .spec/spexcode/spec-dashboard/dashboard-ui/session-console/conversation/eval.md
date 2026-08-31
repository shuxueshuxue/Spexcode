---
scenarios:
  - name: a-selected-passage-can-be-copied-or-quoted
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx]
    related: [spec-dashboard/src/codeSelection.js, spec-dashboard/src/SelectionAttachment.jsx]
    description: >-
      In a real browser open a live session's Conversation and drag-select a passage of an agent note. Right-click
      inside it and read what opens. Pick the quote verb and read the composer: what the attachment LEADS with, whether
      it can be removed, where focus went, and whether the timeline selection was retired. Then type a message and
      send it with the input POST intercepted and ABORTED — read the wire payload rather than delivering anything
      to a live agent, and read whether the attachment survives that refusal. Finally right-click over ordinary
      conversation text with NOTHING selected.
    expected: >-
      The right-click over a selection opens the timeline's own menu with exactly two verbs, copy and quote, and
      the selection is still there under it. Quote puts one shared selection attachment in the composer's preview
      slot leading with the passage's OWN opening words — not the session, which names only the room the reader
      is already standing in — followed by the moment it was said, removable, with the full passage as its
      title and the session recoverable from the token; the timeline selection is retired and focus lands in the composer. The wire payload is ONE ordinary
      message — the same input kind and note-reply mark every other send uses — with the passage appended as the
      shared selection token carrying session, moment and verbatim text; no second field and no second route. A
      refused send keeps the attachment. With nothing selected the press stays the browser's and no menu of ours
      opens. Zero loss = the reader challenges one sentence out of a long turn and the agent cannot mistake which.
  - name: a-long-history-is-reachable-and-says-what-it-omits
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx]
    related: [spec-dashboard/src/data.js]
    description: >-
      Against a real backend, seed one governed session with MORE history than a window holds — several
      hundred authored events, past whatever tail the surface reads — and open it in a real browser. Scroll to
      the TOP of the conversation and read what is there. Then take the way back, if there is one: press it,
      and measure (a) how many rows the page holds before and after, (b) the viewport position of a row that
      was on screen across the press, and (c) the count the top edge states. Separately, watch the network for
      a quiet stretch of polling and read what each timeline request asks for and how many bytes come back.
    expected: >-
      The count names the earlier history and offers the way in — the record's own count, not a guess from
      what is on screen — and it sits AT THE BREAK: below the originating prompt, above the window's oldest
      row. Press it repeatedly and scroll to the top each time: the count falls, and the first row BELOW it
      moves further back in time on every press. Measured from the top of the page instead, the prompt is
      always the first thing there — it is outside the window and never changes — so a count placed above it
      would leave a reader unable to tell the window had moved at all. The row the reader was on does not
      move: growth arrives above it and the scroll absorbs exactly that height. The press is the only thing
      that walks back; reaching the top does not fetch by itself. On a quiet record the poll asks only for
      GROWTH and comes back with none — a few hundred bytes, not the window again.
  - name: a-window-is-measured-in-what-the-reader-faces
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx]
    related: [spec-cli/src/session-timeline.ts]
    description: >-
      Open a REAL record whose notes are long authored prose — hundreds of events, several hundred KiB of
      text, the ordinary shape of a week-long working session — and measure the conversation's scroll height
      against the viewport: how many screens does the first paint hand the reader? Compare a window sized by
      EVENT COUNT alone against one bounded by authored text as well, on the same record.
    expected: >-
      The window is sized by what the reader faces, not by how many rows the record happens to hold. Sized by
      count alone the same 200 events are a couple of screens on a record of short messages and eighty-two on
      a record of long notes — so the number is not a size at all. Bounded by text as well, a long-note record
      yields a proportionally shorter window (tens of screens becoming a handful of events, and the wire
      payload falling with it) while a short-message record is unaffected and still shows its full count. A
      single event longer than the whole budget still comes back: a budget may shrink a window, never empty it.
  - name: the-second-hand-redraws-only-itself
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx]
    description: >-
      Open a LIVE working session whose history is long enough to fill a window (hundreds of rows) so its tail
      seam is counting, and leave it on screen untouched. Over a fixed stretch of wall time, read Chrome's own
      `ScriptDuration` before and after, with the row count and the record's event count captured at both ends
      so the two arms of the comparison are the same page and not two different ones.
    expected: >-
      The per-second count costs a per-second redraw of ONE LINE, not of the history around it: the script
      time over the stretch is a small fraction of what it is when the tick is state on the whole conversation,
      and it does not grow with how much history is on screen. A page that is merely long must not become
      expensive merely by ticking — the seam's number moves every second, and that is all that moves.
  - name: an-unshown-conversation-is-neither-re-rendered-nor-laid-out
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx]
    related: [spec-dashboard/src/SessionInterface.jsx]
    description: >-
      In a real browser fill the console's warm set — visit enough sessions that several Conversations are
      mounted and unshown, since two of them hold too little for any of this to be visible — then ask three
      questions. RENDER: take a CPU profile over a dozen characters typed into a composer that belongs to no
      timeline (the New prompt) and read whether any transcript render work appears in it at all. LAYOUT: with
      that warm set full, measure the per-character cost as shipped, then force the unshown layers' contents
      back into the layout tree and measure again, then restore — an A/B with its own control, because Chrome
      reports REMEMBERED geometry for skipped contents, so a descendant's box proves nothing and the cost of
      the reflow is the only honest observable. STATE: scroll a Conversation into its history, note the
      offset, leave to another session and come back WITHOUT overflowing the warm set, and read the offset
      again — leave far enough to evict it and you are measuring a first visit, which pins to the tail and
      says nothing about whether skipping preserves state.
    expected: >-
      The profile names no transcript render work — no timeline vocabulary, no quote rendering — because a
      layer nobody is looking at is not re-rendered by a neighbour's keystroke. Forcing the unshown layers'
      contents back into layout moves the per-character cost by an order of magnitude and restoring returns
      it: contained, the cost matches an empty console; uncontained, it matches the warm set's whole rendered
      history being measured again per keystroke. The returned-to Conversation is at the exact offset it was
      left at — skipping is not discarding, and keeping the mount is pointless if it loses the reader's place.
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
    code: [spec-dashboard/src/TimelineChat.jsx, packages/transcript-ui/src/vocabulary.ts]
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
      content cell, and nothing textual touches the right edge. Agent notes run the measure (86% of the pane,
      720px–1200px); quotes cap at 80% of it, flush right. Zero envelope phrases render although the API text carries them. Every closed
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
      One centred measure that grows with the pane — 86% of the pane's width, never under 720px, capped at
      1200px, so at 1440px the column is well past 720px and the side margins are the small edge, not the
      leftover — that notes fill and quotes cap at 80% of; gutter time rests below full opacity and comes up
      on hover; the seam is one caption-sized line with no rule to the edge and its chevron last, after the
      words, like every other disclosure on the page; rows sit at least 12px apart; side margin grows a
      little with the pane and shrinks to 14px under the 560px threshold. The ground is the theme's paper,
      dark preset included. No page errors.
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
      One composer card on the page's own paper with a hairline frame, no wider than the reading column (the
      pane-grown measure) and centred on the pane at every width; its send is the shared icon-only mark with a tooltip and an
      aria-label, disabled while the draft is empty and enabled once it is not. Enter posts `kind:command` with
      `replyVia:note` and the typed text, and clears the draft on success. At 760px the gutter is gone and
      times are inline; at 390px the composer sits above the tab bar. No page errors.
  - name: the-live-seam-counts-and-glows
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/src/data.js, spec-dashboard/test/explorer-collapse-folders.e2e.mjs]
    description: >-
      In a real browser open the Conversation of a `working` pane session and of an `asking` one. On the
      working one read the tail seam's lead twice, two seconds apart, and its animation; on the asking one
      read whether any seam is marked live. Open a work fold and a tool output on any session that has them,
      in the dark and in a light preset, and read the fold row's display and the output well's background
      against the theme's `--panel2`.
    expected: >-
      The working seam reads `working · Ns` and N advances by two between the reads without a poll; its lead
      carries the shimmer animation; the asking session marks no seam live. The work-fold row is an
      inline-flex sentence (not a default button) and the tool output's background is the theme's `--panel2`
      in both presets. No page errors.
  - name: an-expanded-live-seam-keeps-counting
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/src/conversationItems.js, spec-dashboard/test/live-tail.e2e.mjs]
    description: >-
      In a real browser open the Conversation of a working session whose tail seam is live, feed its transcript
      stream successive frames for the same interval, expand the seam, and read: the seam's `N turns · M tool
      uses` before and after each frame, whether the inset ever shows the loading line once it has content, and
      whether the page makes any interval GET for the open seam.
    expected: >-
      The open seam's numbers follow the streamed frames instead of freezing at the moment of expansion, its
      inset never falls back to the loading line once it has content, and the open seam issues no interval GET
      of its own — the stream is its only read. No page errors.
  - name: stop-is-one-square-while-working
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/test/explorer-collapse-folders.e2e.mjs]
    description: >-
      In a real browser open the Conversation of a session that is `working` and of one that is `asking`.
      Read the composer line of each: what sits beside send, its element kind, accessible name, size and
      position. Intercept the interrupt request at the network edge and press stop on the working one.
    expected: >-
      The working session's composer carries one stop square left of send — a BUTTON with a tooltip and an
      aria-label, the same 26px square as send, filled at rest in the theme's working orange (the `--orange`
      token, not the quiet wash) with paper-coloured glyph — and pressing it posts exactly one interrupt for
      that session through the one verb. The asking session's composer carries no stop control at all. No
      page errors.
  - name: a-working-agent-always-ends-with-an-open-seam
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/src/conversationItems.js, spec-dashboard/test/conversation-working-tail.e2e.mjs]
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
  - name: a-closed-stretch-folds-to-its-row
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/seam-fold-motion.e2e.mjs
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/src/useFold.js, spec-dashboard/src/styles.css]
    description: >-
      In a real browser open the Conversation of a working session whose open seam is streaming a live tail —
      the agent's newest prose and the calls under it — then type a message into the composer and press Enter,
      so the record comes back carrying that `sent` event and closes the stretch above it. Sample the outgoing
      seam's own height on every animation frame across the change and count the distinct heights it passes
      through; read its lead before and after, how many seams and tails are left, the height it settles at
      against its row's, and whether any wrapper the movement mounted is still in the DOM once it is over.
      Then run the whole scenario again with the browser asking for reduced motion. LOOK at the mid-fold
      frame: every number here passes while the collapse still happens between two frames.
    expected: >-
      The lead goes from `working · <span>` to `worked <span>`, the message splits one stretch into two seams,
      and the closed one keeps no live tail and settles at its row. Getting there is a MOVEMENT: the seam
      passes through many heights over about one panel fold, and mid-movement the outgoing tail is on screen,
      clipped and fading, under a row that already reads `worked`. Nothing the movement mounted outlives it.
      Under reduced motion the same close is a single step, at the same settled height and with nothing left
      behind. Before the change every one of these was a single step.
  - name: the-conversation-composer-is-a-command-box
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/conversation-command-box.e2e.mjs
    code: [spec-dashboard/src/TimelineChat.jsx, spec-dashboard/src/mentions.jsx, spec-dashboard/src/useAttachQueue.jsx]
    description: >-
      Boot an isolated backend over a fresh temporary project with one spec node and one live fake-harness
      session, open that session's Conversation in a real browser, and work every door of its footer: type
      `/` and read the rows and their order, Escape, pick a non-board row; type `@`, pick `@new`, pick the
      launcher; type `[[`, pick the node, add a unique token and press Enter, then read the session's own
      timeline and the harness's pane; paste a file, pick one through the paperclip, drop one on the
      composer and read the draft and the backend's upload sink; finally type the bare board line `/eval`
      and press Enter, reading the address and the timeline afterwards.
    expected: >-
      The `/` palette lists the board's `[ui]` rows (`/eval`, `/stop`, `/close`) before the preset and
      harness rows; Escape closes it and keeps the draft; a non-board row inserts `/<name> `. `@` leads to
      `@new:` and then `@new:fake `. `[[` inserts `[[fixture]] `, and the sent event on the timeline — and
      the text the harness echoes — carry `[[fixture]] (<path>/fixture/spec.md)`, with `replyVia: note` and
      the draft cleared on delivery. Each of paste, pick and drop uploads through the resumable stream and
      splices its absolute `spexcode-uploads/` path into the draft, space-padded, three paths in the end,
      each readable on the backend; the composer rings while a file hovers. The bare `/eval` line navigates
      to the session's Evals door and appends nothing to the timeline. No page errors.
---
# measuring conversation

Three lifecycle states, one DOM: the measurement compares components, not screenshots of similar-looking panes.
