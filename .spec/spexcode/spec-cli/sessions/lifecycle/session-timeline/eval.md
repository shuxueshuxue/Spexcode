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
---

# session-timeline — yatsu

Measure through the real HTTP surface (`/api/sessions/:id/timeline`) against a real `spex serve`, never by
importing the module: the loss being scored is that ONE observer covers EVERY lifecycle writer — most
critically the pure-shell sed write the mark-active hook does, the writer that would silently vanish from
any per-writer instrumentation — and that history survives a server restart without duplication.
