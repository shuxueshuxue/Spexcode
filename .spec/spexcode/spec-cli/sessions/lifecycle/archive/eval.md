---
scenarios:
  - name: shelve-and-restore-round-trip
    test: spec-dashboard/test/archive-shelf.e2e.mjs
    description: >
      Drive the real dashboard console in a browser against a live backend. Starting from the session
      list, archive the SELECTED live Codex leaf through the product's own Command Box (`/archive`), then read
      the rendered DOM and API/resource census at each step: the header's three pills, the row leaving the default
      graph/list/edges, the flat archive collection, and the offline archive card. Resume with the card's one
      button and observe the same conversation returning through starting -> online. Capture process/runtime and
      sibling shared-root evidence alongside `GET /api/sessions?all=1` and `GET /api/resources`.
    expected: >
      Archive succeeds only after exact leaf/tmux/adapter cleanup: the record preserves worktree, branch, dirty
      bytes, and conversation identity while reading `archived:true`, `stopped:true`, `status:offline`,
      `liveness:offline`. The default API/graph/edges/subsession counts, maxActive occupancy, and active resource
      owners exclude it; the explicit history API shows it as a flat cold row with no status zones. The shared
      app-server PID/start/socket and sibling loaded/new-turn reference remain unchanged. Resume is the card's
      only exit and recreates the same conversation through starting -> online. A guard refusal is nonzero/409,
      keeps the record unarchived and visible, and leaves all runtime/worktree/shared-root evidence unchanged.
    tags: [frontend-e2e]
  - name: shelving-costs-no-git-walk
    description: >
      Call the default `GET /api/graph` and the explicit `GET /api/sessions?all=1` and compare the same archived
      record. The default graph is a working-set projection; the explicit history read is the cold archive view.
    expected: >
      A true cold archive is absent from default graph/list/hover/edges/subsession counts and active resources,
      while the explicit history record is offline with `ops` empty. The adapter residency census is one
      project-wide paginated loaded-ID read (O(pages), no per-thread `thread/read`); a legacy archived+live or
      externally reloaded violation is instead projected archived:false with real liveness/status plus an
      `archiveHazard` marker until an explicit repair. A dead PID plus socket with no live listener is a healthy
      empty root, while a live or ambiguous root remains a visible hazard.
    tags: [backend-api]
  - name: archive-cold-runtime-and-capacity
    description: >
      Against two real Codex sibling leaves on one project app-server, capture a pre-archive and post-archive
      census through the default session API/graph/edges, `spex session resources --json`, and configured
      `sessions.maxActive` queue capacity.
    expected: >
      The A census may show the archived-live hazard and shared-root guard loss. The B archive succeeds only with
      exact target PID/start/argv/thread ownership and detached shared-root proof despite unrelated unowned refs;
      target runtime/artifacts are gone, target is offline history-only, sibling leaf and shared app-server
      identity/ref remain and can take a new turn, and capacity/resources no longer charge the target.
    tags: [backend-api, cli]
  - name: archive-guard-failure-visible
    description: >
      Attempt archive through HTTP and CLI with unhealthy/undetached shared-root proof, ambiguous/unowned target
      leaf, stale PID, or an artifact swap while the real resource census is live.
    expected: >
      Archive is nonzero/HTTP 409, record remains projected archived:false/visible (or explicit archiveHazard),
      and target/shared-root/worktree/branch are unchanged. No read projection performs an automatic repair.
    tags: [backend-api, cli]
  - name: watch-wait-presence-through-archive-resume-close
    test: spec-dashboard/test/archive-shelf.e2e.mjs
    description: >
      Against the same isolated backend and real Codex target as the browser runner, keep a real `spex session
      watch`/`wait` process on the fixed selector while the product API/browser drives working -> archive/offline
      -> resume/starting -> online -> close. Inspect the emitted event stream and served all-record rows.
    expected: >
      Archive is observed as an offline transition and never as gone/closed; resume remains the same record and
      conversation; only the subsequent true record/worktree removal emits one closed event and returns gone.
      The monitor uses active-only events plus all-record presence and never infers existence from the default
      active-only projection. The in-memory helper is only a narrow unit regression, not a YATU reading.
    tags: [backend-api, cli]
---

# eval — archive

YATU: measured through the surfaces a human actually touches — a real Chromium driving the real dashboard
over a real backend for the console journey, and the real HTTP endpoint for the board-cost claim. No internal
helper is called to make either proof easy: the shelving act itself goes through the Command Box exactly as a
human would type it, and every assertion reads rendered DOM or a served payload.

The round trip is a **multi-step interaction flow**, so its evidence is a recording of the run with a
step-map exported by the runner, not a still — a single frame could show the shelf card while saying nothing
about whether the row actually left, came back, or whether the button was reachable at all. That last one is
not hypothetical: the first run of this scenario failed because a live xterm layer sat over the card and
swallowed the restore click while the card looked perfectly correct in a screenshot.
