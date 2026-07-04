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
---
# yatsu.md — board-cache

The board build is measured by **driving the real backend under a poll storm** (backend YATU through the
HTTP surface, not a unit test): does a normal dashboard's overlapping `/api/board` polls stay cheap, and
does the git-free `/health` liveness probe keep answering *while* the board is being read? The loss signal
here is a latency budget — a regression that re-introduces per-poll rebuilds or a synchronous build stall
shows up as a wedged `/health`, exactly the symptom this node exists to prevent. See [[board-cache]].
