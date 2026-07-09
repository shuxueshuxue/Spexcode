---
scenarios:
  - name: poll-storm-doesnt-wedge-health
    tags: [backend-api]
    description: >-
      Measure the board hot path through the REAL HTTP surface, not by reasoning about the code. Start a
      throwaway backend on a free port (pin PORT, `env -u SPEXCODE_API_URL` so it doesn't inherit a live
      one): `env -u SPEXCODE_API_URL PORT=8799 npx tsx spec-cli/src/index.ts`, poll /health until it
      answers. Then (1) warm the cache with one `curl /api/board`, and time a second warm `curl /api/board`;
      (2) fire 10 concurrent `curl /api/board` in the background and, while they run, time ~40 sequential
      `curl /health` and record the WORST latency. File the readings with the before/after numbers as note
      evidence via `spex yatsu eval board-cache --scenario poll-storm-doesnt-wedge-health`.
    expected: >-
      A warm /api/board is served from cache in well under 1s (no rebuild), and the 10x concurrent poll
      storm triggers ONE build at most (zero when already warm) — never one-build-per-request — so the
      worst /health during the storm stays near its idle latency (~1s or less on a loaded box), NOT the
      tens-of-seconds a per-request rebuild causes. The baseline (route calling buildBoard() inline, no
      cache) fails this: warm /api/board rebuilds every time (~5s) and worst /health under the storm blows
      past 50s as the git-free liveness probe starves behind N concurrent full builds.
  - name: wedged-build-settles-and-recovers
    tags: [backend-api]
    description: >-
      Prove the build NECESSARILY settles: a buildBoard() whose awaited git children never exit must not
      pin the single-flight forever. Recipe (deterministic, external injection only): make a throwaway
      fixture git repo with a 2-node .spec tree and one commit; put a PATH shim `git` ahead of the real
      one that, iff a trigger file exists and a positional arg (before `--`) is `log`/`rev-list`, hangs
      forever (`sleep 3600` loop), else `exec`s the real git. Touch the trigger, start the backend from
      the fixture dir on a pinned FREE port (`env -u SPEXCODE_API_URL PORT=<free>`; lower the walls for
      test speed: SPEXCODE_GIT_TIMEOUT_MS≈8000, SPEXCODE_BOARD_BUILD_TIMEOUT_MS≈15000), issue one
      `curl /api/board` to start the cold build (both history walks wedge), then REMOVE the trigger (git
      is instantly healthy; the already-spawned children stay hung). Now measure, with NO restart:
      /api/board and /api/specs over the next watchdog window, the server log, and the hung children.
    expected: >-
      Without any restart, /api/board answers 200 within the build-watchdog window after the hang is
      removed (the wedged children are SIGKILLed at the git timeout, the wedged build settles, the next
      read retries fresh), a LOUD console warning naming the wedge appears in the server log, and
      /api/specs answers 200 again too — no route left hanging connections. The pre-fix baseline fails
      every clause: inflight stays pinned (finally never runs), /api/board 503s forever with ZERO log
      lines even minutes after git recovered (restart the only cure), /api/specs holds connections open
      indefinitely (http=000) while HEAD is stationary, and the hung git children accumulate unkilled.
---
# yatsu.md — board-cache

The board build is measured by **driving the real backend under a poll storm** (backend YATU through the
HTTP surface, not a unit test): does a normal dashboard's overlapping `/api/board` polls stay cheap, and
does the git-free `/health` liveness probe keep answering *while* the board is being read? The loss signal
here is a latency budget — a regression that re-introduces per-poll rebuilds or a synchronous build stall
shows up as a wedged `/health`, exactly the symptom this node exists to prevent. See [[board-cache]].
