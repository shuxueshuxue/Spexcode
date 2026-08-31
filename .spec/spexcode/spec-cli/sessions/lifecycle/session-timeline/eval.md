---
scenarios:
  - name: the-window-says-what-it-omits
    tags: [backend-api]
    code: [spec-cli/src/session-timeline.ts]
    related: [spec-cli/src/index.ts]
    description: >-
      On an ISOLATED store, drive a real backend until one governed session holds MORE authored history than
      one window — hundreds of events through the ordinary input route and `spex internal session-state` —
      then read `GET /api/sessions/:id/timeline` four ways and compare the answers to each other: with no
      cursor; with `before=<the position the first answer named>`; with `since=<the stamp the first answer
      carried>` both while the record is quiet and after one further message; and with a `since` far enough
      behind that the growth exceeds the window. Seed the session so it has MIGRATED history too, whose
      sequence is high where its time is early.
    expected: >-
      Every answer states where it sits: the tail carries the window's `offset` and the history's `total`, so
      a reader can say how much earlier history exists rather than ending in silence at an unmarked edge. The
      `before` page is exactly the events preceding the tail — the two windows join with no gap and no overlap
      — and walking back terminates at position 0 instead of running past it. A `since` read on a quiet record
      returns NO events and NO window, which is what makes a poll on a long record cheap; after one message it
      returns exactly that message. Growth past the window size is answered with a whole window instead
      (it carries `offset`), because a reader that far behind is re-seated, not caught up. Migrated history
      never leaks between the two orders: the stamp is a SEQUENCE and only ever names growth, while a page is
      addressed by POSITION in the order the reader sees, so no read hands back events scattered through time.
  - name: one-writer-one-line
    tags: [backend-api, cli]
    description: >
      On an ISOLATED store (SPEXCODE_HOME override), seed a governed session record, then start N real
      `spex serve` processes that resolve to the SAME project root, so they share one sessions store — the
      ordinary state of a dogfood box, where every live supervisor and every hot-reloaded child is another
      backend on the same store. Drive real lifecycle transitions (awaiting/merge with a note, then active,
      repeated) through the SAME writer every hook uses, `spex internal session-state`, and count the logical
      timeline events each move produced, spanning numbered segments when the configured byte threshold rotates.
    expected: |
      Each real transition appears EXACTLY ONCE, whatever N is. There is one writer path — every hook
      shells to `spex internal session-*` — so nothing writes state behind the log's back and no process
      observes the store to catch up. Before the repair the count was `1 + N`, LINEAR in the number of live
      backends: each one ran its own fs.watch over the shared store and appended its own catch-up line.
      At N=5, 24 independently authored moves produce 24 logical events, including across byte-rotated
      immutable segments. The read surface therefore returns the log as it is, with no adjacent-duplicate folding to
      hide the defect, and an unknown id still answers 404.
  - name: the-append-accepts
    tags: [backend-api, cli]
    description: >
      On an ISOLATED store, send to a governed session whose harness adapter CANNOT be reached (no
      rendezvous socket, no tmux window), and separately to a RETIRED session whose worktree directory has
      been removed. Read each session's timeline.ndjson and its delivery queue afterwards. Then send to an id
      with no record at all.
    expected: |
      Both sends report success and both messages are in the log: acceptance is the write, and the failed
      handover only decides whether the agent sees it this turn or after a retry. The unreachable target
      still OWES its message — the entry stays on its delivery queue, and no cursor moves anywhere. The
      retired session receives too — the record gate governs the lifecycle axis (it still refuses to be
      marked active), while a message it cannot act on must still leave a trace. Only the unknown id fails,
      loudly, and records nothing.
  - name: note-terminal-switch
    tags: [backend-api]
    description: >
      Against a real backend and a REAL dispatched worker (a trivial ack-only probe agent), drive the
      one input route three times and capture the worker's pane after each confirmed delivery:
      (1) a send with replyVia:"note" (the phone composer's shape), (2) a plain human send,
      (3) another plain human send. Then GET the session's timeline.
    expected: |
      Delivery 1 arrives with the terminal-free notice appended (complete reply belongs in --note; the
      notice declares itself per-message). Delivery 2 — the note→terminal transition — arrives wrapped
      in the terminal-attached counter-insert that explicitly countermands note replies. Delivery 3
      arrives BARE: the counter-insert fires exactly once at the transition, never on ordinary
      terminal conversation. The timeline's three sent events record the caller's texts WITHOUT any
      insert (hints are transport, not conversation).
  - name: headless-default-note-reply
    tags: [backend-api, cli]
    description: >
      Against a real backend, create a REAL pi-headless or opencode-headless session whose initial prompt
      asks a question with one exact answer token, without supplying replyVia. After that turn settles,
      GET the session timeline and public session record. Then send a second exact-answer question through
      `spex session send` (again with no replyVia) and read the same public surfaces. Run this exact scenario
      before and after the repair.
    expected: |
      Both the launch prompt and the CLI send are treated as note-reply messages because the TARGET
      session's harness is headless: each exact answer reaches the durable timeline as a full declaration
      note, even though neither caller supplied replyVia. The decision belongs to one server-side prompt
      composition seam shared by launch, input, CLI send, and merge dispatch; explicit replyVia remains an
      input override. Timeline sent text, where present, excludes the transport insert.
---

# session-timeline — yatsu

Measure against real `spex serve` processes and the real CLI writer, never by importing the module. Two
losses are being scored. First, that the log records each authored move ONCE: the defect this replaced was
self-inflicted — the recorder's own fs.watch observer, running in every stray backend on the box, re-recorded
every real transition, and a read-time fold hid it. Counting lines with several serve processes alive is the
only measurement that can see it. Second, that a send's success means the bytes are in the log and nothing
else, so an unreachable or retired target still leaves a trace instead of vanishing.
