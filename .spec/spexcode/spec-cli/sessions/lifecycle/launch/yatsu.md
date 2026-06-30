---
scenarios:
  - name: cap-counts-only-the-working-set
    tags: [backend-api]
    description: >
      Measure the concurrency cap through the REAL backend board (`/api/board`, i.e. `spex board`) — the
      same status truth the dashboard renders. With the cap N = `spexcode.json` `sessions.maxActive`, look at
      a board that has MORE live sessions than N, where several are `idle`/`asking`/`review`/`done` (waiting
      on the human) alongside the `working`/`parked` ones, plus some `queued`. Confirm which sessions occupy
      a slot: count the live `working` + `parked` agents and compare to how many `queued` sessions remain
      stuck. Then confirm the queue DRAINS once working+parked drops below N (e.g. an agent goes `asking`).
    expected: |
      Only live `working` and `parked` agents occupy a slot; `idle`, `asking`, and the proposal states
      (`review`/`done`/`close-pending`) do NOT — exactly like `offline`/`queued`. So the number of `queued`
      sessions is governed by the count of working+parked agents, never by the total alive count: a board
      with (say) 2 working + 4 asking has only 2 slots filled, and any `queued` sessions launch rather than
      waiting behind the 4 asking. The cap throttles concurrent COMPUTE, not live processes.
    code: spec-cli/src/sessions.ts
  - name: cap-value-comes-from-spexcode-json
    tags: [backend-api]
    description: >
      Confirm the cap is configured in JSON, not hardcoded. Read `spexcode.json` `sessions.maxActive` and the
      live board's occupied/queued counts. Then EDIT `sessions.maxActive` (raise or lower it) and, without
      restarting the backend, watch the next drain tick: a raised cap should launch more `queued` sessions; a
      lowered cap should stop launching new ones (already-running agents are never killed). Precedence:
      `spexcode.json` wins, else the `SPEXCODE_MAX_ACTIVE` env, else default 6; a value < 1 floors to 1.
    expected: |
      The effective cap equals `spexcode.json` `sessions.maxActive` when present (env only fills in when the
      JSON key is absent; default 6 when neither is set). A live edit to the JSON re-tunes the cap on the
      next drain with no backend restart — raising it drains more `queued` sessions immediately, lowering it
      simply stops further launches (running agents keep their slots). The cap value is never baked into the
      toolchain.
    code: spec-cli/src/sessions.ts, spec-cli/src/layout.ts
---

# launch — yatsu

Measured through the **real backend board** (`/api/board` = `spex board`), the same status source the
dashboard renders — never an internal counter. The loss being scored is the cap contract: a slot is
**compute** pressure, so only live `working`/`parked` agents hold one (everything waiting-on-the-human frees
it), and the cap **value lives in `spexcode.json`**, read live so it tunes without a restart.
