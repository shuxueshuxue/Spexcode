---
scenarios:
  - name: observer-records-every-writer
    tags: [backend-api, cli]
    description: >
      Against a throwaway backend on an ISOLATED store (SPEXCODE_HOME override), create a governed
      session record, then mutate its (status, proposal, note) the way each real writer does — including a
      raw sed value-replace of session.json, exactly the mark-active shell hook's write, which no TS-layer
      instrumentation could see. Deliver nothing; just move the record through active → asking(note) →
      awaiting/merge(note). Then GET /api/sessions/:id/timeline. Restart the backend and GET again.
    expected: |
      The timeline returns the transitions in order, each with an ISO timestamp, the FULL note text, and
      the composed display word (awaiting+merge → "review", active → "working"). The sed-written transition
      appears like any other (the observer covers writers the TS layer never sees). After a backend restart
      the endpoint returns the SAME events — no duplicate genesis lines (the recorder re-seeds from the
      persisted tail). An unknown id answers 404.
  - name: duplicate-append-fold
    tags: [backend-api]
    description: >
      Seed an ISOLATED store (SPEXCODE_HOME) with a governed session whose timeline.ndjson carries
      ADJACENT IDENTICAL status lines — the shape two serve processes observing ONE store append (a
      throwaway eval/worktree serve beside the live one: each keeps its own lastSeen, so one record
      move lands twice). GET /api/sessions/:id/timeline against a throwaway serve on that store.
    expected: |
      The read surface folds each run of adjacent status events with identical (status, proposal,
      note) into its first line: the response never shows the same status word twice in a row with
      the same note. Genuinely distinct neighbours (same word, different note) and sent events are
      untouched; the kept events' order and timestamps are unchanged.
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
---

# session-timeline — yatsu

Measure through the real HTTP surface (`/api/sessions/:id/timeline`) against a real `spex serve`, never by
importing the module: the loss being scored is that ONE observer covers EVERY lifecycle writer — most
critically the pure-shell sed write the mark-active hook does, the writer that would silently vanish from
any per-writer instrumentation — and that history survives a server restart without duplication.
