---
scenarios:
  - name: launch-establishes-session-identity
    tags: [backend-api, cli]
    code: spec-cli/src/sessions.ts
    description: >
      Read the launch line a REAL session is given (its `launch.sh` in the global store), then dispatch a real
      worker of every configured harness family — an interactive claude, opencode, pi, and a headless one —
      into an isolated `spex init` project through a backend running this code, and read the `Session:`
      trailer on the commit each worker actually makes.
    expected: >
      The launch line STRIPS every session-identity variable it inherited before setting this session's own
      record id: a pane inherits the tmux SERVER's environment, so without the strip whichever session
      started that server (or any daemon in the ancestry) rides along into every later worker. Every family
      still boots through that prefix — the prefix is one string in front of each harness's own command —
      reaches `active`, and lands a commit whose trailer names ITS OWN record. The failure this locks:
      github#76, where a shared daemon's inherited id reached workers' commits and 48 of them in the SpexCode
      repo name a session that no longer exists.
  - name: launch-prompt-may-begin-with-a-hyphen
    tags: [backend-api, cli]
    code: spec-cli/src/sessions.ts
    description: >
      In an isolated `spex init` project through a real backend running this code, create a session through
      the real `POST /api/sessions` whose prompt's FIRST CHARACTER is `-` — the shape a human actually
      produces by pasting a browser console line (`-home-…/api/uploads:1  Failed to load resource: … 413 …`),
      a diff hunk, or a quoted flag. Do it per configured harness family, and read the generated `launch.sh`,
      the worker pane, the session's status through `/api/sessions`, and whether the agent received the text.
    expected: |
      The prompt is arbitrary human text: its first character carries no meaning to SpexCode, so the worker
      boots and receives the text VERBATIM. Every harness parses its own argv, so where the end-of-options
      separator goes — or whether that harness even has one — is an ADAPTER fact and never a product-code
      assumption that a quoted positional works everywhere. No harness may echo the prompt back as
      `unknown option`, fast-exit into the bounded readiness retry, and settle `offline` with nothing run:
      that is the field failure this locks (a dashboard-created claude session died on three identical
      retries, its own prompt quoted in the parser error).
      Where a harness's parser genuinely has NO escape — pi's `dist/cli/args.js` has no `--` branch and
      errors on any leading-`-` token — the create is refused ONCE and loudly, naming the harness fact and
      the repair. A refusal is the honest answer there; silently editing the human's text so the parser
      accepts it is not, and neither is three retries of a certain failure.
  - name: cap-counts-only-the-working-set
    tags: [backend-api]
    description: >
      Measure the concurrency cap through the REAL backend board (`/api/graph`, i.e. `spex graph --json`) — the
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
  - name: deterministic-launch-failure-fails-once
    tags: [backend-api]
    description: >
      Drive the real launch path with failures of two different kinds and count the attempts each produces:
      (a) a DETERMINISTIC one — a resume whose harness conversation does not exist, a missing worktree, a
      missing branch, an unresolvable launcher command — and (b) a genuinely unclassifiable fast launcher
      exit before readiness. Read the attempt count and what the caller is told.
    expected: |
      A deterministic failure is attempted EXACTLY ONCE and fails loud with its own structured reason —
      nothing retries it, and nothing regenerates a launch script for it. Only the unclassifiable fast exit
      keeps the bounded readiness retry. The classification is the harness adapter's and the launch
      transport's; product state consumes the structured class and never re-derives it by matching a
      harness's English error text. A missing conversation with a live worktree is routed to the explicit
      repair/force entry, never to an implicit new-conversation fallback.
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
  - name: command-preset-has-one-launch-owner
    tags: [backend-api]
    description: >
      In an isolated real project with a `surface: command` preset whose body contains its own `[[links]]`
      and a launcher stub that records the agent argv, create a session through the real `POST /api/sessions`
      using raw `/tidy [[session-console]] quick smoke test`. Read the resulting session through
      `/api/sessions` and the prompt the launched stub receives. Then create raw `/tidy` with no target.
    expected: |
      The API accepts raw invocation text; the targeted session is bound to `session-console` and stores the
      raw slash line as its originating prompt/preview, while the launcher receives the expanded preset body,
      the resolved target path, free text, and the ordinary spec pointer. For targetless `/tidy`, the session
      stays node-agnostic and its identity comes from raw `/tidy`; the plugin body's own `[[links]]` never
      becomes scope. This same `newSession` seam serves dashboard, phone, CLI, direct API, and in-process launch.
    code: spec-cli/src/sessions.ts
    test: spec-cli/src/sessions.test.ts
---

# launch — yatsu

Measured through the **real backend board** (`/api/graph` = `spex graph --json`), the same status source the
dashboard renders — never an internal counter. The launch script itself is also a backend-owned surface: it
is the exact file the worker pane runs. The loss being scored is the cap contract and launch bring-up
honesty: a slot is **compute** pressure, so only live `working`/`parked` agents hold one (everything
waiting-on-the-human frees it), the cap **value lives in `spexcode.json`**, read live so it tunes without a
restart, and a retryable fast launch exit reports the observed condition without inventing a cause.
