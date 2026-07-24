---
scenarios:
  - name: poll-storm-doesnt-wedge-health
    tags: [backend-api]
    description: >-
      Measure the board hot path through the REAL HTTP surface, not by reasoning about the code. Start a
      throwaway backend on a free port (pin PORT, `env -u SPEXCODE_API_URL` so it doesn't inherit a live
      one): `env -u SPEXCODE_API_URL PORT=8799 npx tsx spec-cli/src/index.ts`, poll /health until it
      answers. Then (1) warm the cache with one `curl /api/graph`, and time a second warm `curl /api/graph`;
      (2) fire 10 concurrent `curl /api/graph` in the background and, while they run, time ~40 sequential
      `curl /health` and record the WORST latency. File the readings with the before/after numbers as note
      evidence via `spex yatsu eval board-cache --scenario poll-storm-doesnt-wedge-health`.
    expected: >-
      A warm /api/graph is served from cache in well under 1s (no rebuild), and the 10x concurrent poll
      storm triggers ONE build at most (zero when already warm) — never one-build-per-request — so the
      worst /health during the storm stays near its idle latency (~1s or less on a loaded box), NOT the
      tens-of-seconds a per-request rebuild causes. The baseline (route calling buildBoard() inline, no
      cache) fails this: warm /api/graph rebuilds every time (~5s) and worst /health under the storm blows
      past 50s as the git-free liveness probe starves behind N concurrent full builds.
  - name: stale-readers-ride-last-good-during-rebuild
    tags: [backend-api]
    description: >-
      Measure the SWR contract at production scale through the REAL HTTP surface. Corpus: a adopter-a-shaped
      repo (~440 spec nodes, ~10k commits, ~26 governed session records over ~26 worktrees — a full rebuild
      after a main-branch commit costs seconds, not ms). Start a throwaway backend from the corpus dir on a
      pinned free port (`env -u SPEXCODE_API_URL PORT=<free> SPEXCODE_HOME=<iso> npx tsx
      spec-cli/src/index.ts`), warm the cache with one `/api/graph` (record its ETag), and open one
      `/api/graph/stream?mode=delta` subscriber logging event arrival times. Then fire a REAL full
      invalidation (a `git commit` on the corpus main branch — the refs watcher fires 'full') and
      immediately launch 20 concurrent `curl /api/graph` readers plus sequential `/health` probes, timing
      every response. After the rebuild settles, read `/api/graph` once more and compare ETag + the
      stale/refreshing response headers across the three phases.
    expected: >-
      Once a last-good board exists, a full-dirty window never blocks or 503s a plain HTTP reader: all 20
      concurrent readers return the last-good board in well under 200ms, each explicitly labeled stale
      (x-spexcode-graph: stale, refreshing) — never silently fresh — while exactly ONE background rebuild
      runs (single-flight; one budget-warning line, not twenty). /health keeps answering near idle latency
      throughout. When the rebuild completes the content genuinely advances: the post-settle /api/graph
      returns a NEW ETag with no stale label, and the delta subscriber receives the fresh
      graph-delta/graph-full without any client action. A first-cold reader (no last-good yet) still waits
      honestly for the first build — it is never handed a fabricated board. The pre-SWR baseline fails the
      core clause: every reader during the dirty window blocks the full rebuild length (measured 7.7s on the
      corpus box; 22s→503 on adopter-a production) because getBoard() makes every caller await the in-flight
      full build even when a perfectly good last-good board is cached.
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
      `curl /api/graph` to start the cold build (both history walks wedge), then REMOVE the trigger (git
      is instantly healthy; the already-spawned children stay hung). Now measure, with NO restart:
      /api/graph and /api/specs over the next watchdog window, the server log, and the hung children.
    expected: >-
      Without any restart, /api/graph answers 200 within the build-watchdog window after the hang is
      removed (the wedged children are SIGKILLed at the git timeout, the wedged build settles, the next
      read retries fresh), a LOUD console warning naming the wedge appears in the server log, and
      /api/specs answers 200 again too — no route left hanging connections. The pre-fix baseline fails
      every clause: inflight stays pinned (finally never runs), /api/graph 503s forever with ZERO log
      lines even minutes after git recovered (restart the only cure), /api/specs holds connections open
      indefinitely (http=000) while HEAD is stationary, and the hung git children accumulate unkilled.
---
# eval.md — board-cache

The board build is measured by **driving the real backend under a poll storm** (backend YATU through the
HTTP surface, not a unit test): does a normal dashboard's overlapping `/api/graph` polls stay cheap, and
does the git-free `/health` liveness probe keep answering *while* the board is being read? The loss signal
here is a latency budget — a regression that re-introduces per-poll rebuilds or a synchronous build stall
shows up as a wedged `/health`, exactly the symptom this node exists to prevent. See [[graph-cache]].
