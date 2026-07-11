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
      `spexcode.json` wins, else the `SPEXCODE_MAX_ACTIVE` env, else default 8; a value < 1 floors to 1.
    expected: |
      The effective cap equals `spexcode.json` `sessions.maxActive` when present (env only fills in when the
      JSON key is absent; default 8 when neither is set). A live edit to the JSON re-tunes the cap on the
      next drain with no backend restart — raising it drains more `queued` sessions immediately, lowering it
      simply stops further launches (running agents keep their slots). The cap value is never baked into the
      toolchain.
    code: spec-cli/src/sessions.ts, spec-cli/src/layout.ts
  - name: fast-exit-retry-log-is-cause-neutral
    tags: [backend-api]
    description: >
      Measure the launch retry diagnostic at the same backend-owned launch script surface that a worker runs:
      generate a real `launch.sh` for a launcher command that exits quickly before readiness, run that script,
      and inspect stderr. The script may retry because the exit was fast, but the diagnostic must not claim a
      specific unproven cause such as a launcher daemon race.
    expected: |
      The retry line reports only the observed condition: an attempt exited quickly before readiness and is
      being retried. It does NOT contain "likely a launcher daemon race" or otherwise name a daemon race
      unless that cause was actually proven. Bounded fast-exit retry remains intact.
    code: spec-cli/src/sessions.ts
    test: spec-cli/src/sessions.test.ts
  - name: creation-materialize-failure-is-loud
    tags: [backend-api]
    description: >
      Measure the creation-time materialize failure path at the session-creation seam: make the worktree
      materialize throw during session creation and inspect (a) the backend's stderr and (b) the
      session's global `session.json` record. The creation-time materialize is bootstrap — it wires the very
      hooks every lifecycle dispatch rides on — so a swallowed failure means the worker launches ungoverned with
      nothing anywhere saying so.
    expected: |
      The failure is loud and durable: stderr names the failed materialize, the worktree path, and the
      underlying cause, and the session record's `note` field carries the same failure (so the board/watch
      surface the degraded worker). The launch itself still proceeds — degraded but visible, never refused —
      and no inferred `error` status is written (status stays agent-authored).
    code: spec-cli/src/sessions.ts
    test: spec-cli/src/sessions.test.ts
---

# launch — yatsu

Measured through the **real backend board** (`/api/board` = `spex board`), the same status source the
dashboard renders — never an internal counter. The launch script itself is also a backend-owned surface: it
is the exact file the worker pane runs. The loss being scored is the cap contract and launch bring-up
honesty: a slot is **compute** pressure, so only live `working`/`parked` agents hold one (everything
waiting-on-the-human frees it), the cap **value lives in `spexcode.json`**, read live so it tunes without a
restart, and a retryable fast launch exit reports the observed condition without inventing a cause.
