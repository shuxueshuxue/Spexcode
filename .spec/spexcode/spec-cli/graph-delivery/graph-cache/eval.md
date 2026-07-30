---
scenarios:
  - name: unchanged-patrol-does-not-rebuild
    tags: [backend-api]
    code: [spec-cli/src/graphCache.ts, spec-cli/src/graphStream.ts]
    description: >-
      A/B the real HTTP and delta-SSE surfaces on one frozen production-shaped corpus and one frozen copy of
      its session store (roughly 180 spec nodes, thousands of historical readings, tens of governed sessions,
      and scores of linked worktrees). Pin the source SHA and start an isolated backend with
      `SPEXCODE_BOARD_DEBUG=1`, warm `/api/graph`, then hold one `/api/graph/stream?mode=delta` subscriber for
      at least three 15-second patrol windows while issuing cached `/api/graph` and `/health` reads and sampling
      backend CPU. Record every graph-build warning, trigger tag, ETag and response status. In separate isolated
      rounds, make one real session-record change, one governed spec change, and one eval-reading sidecar change,
      and observe the same stream plus a final full graph read. A and B must use independent copies of the exact
      same frozen data root so one run cannot preheat or mutate the other.
    expected: >-
      After the initial delta anchor settles, three unchanged patrol windows start zero full board assemblies:
      the ETag stays fixed, cached graph and health reads remain 200 near idle latency, and backend CPU returns to
      its idle platform instead of spending each patrol interval rebuilding an identical graph. The patrol still
      verifies its authority through one cache-owned single-flight operation; it adds no second timer or
      overlapping producer. A real session-record change advances the session unit through the sessions splice,
      and real governed spec and eval-reading changes each advance the affected graph semantics through a full
      rebuild. Concurrent patrol, HTTP and stream callers share the same operation, and no real graph/session/eval
      change is hidden or delayed beyond the existing patrol/watch cadence.
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
  - name: normal-build-memory-platform
    tags: [backend-api]
    description: >-
      Measure repeated successful full builds on the local production-scale adopter-a corpus through the
      isolated backend/CLI harness only (never a deployed service). Pin a throwaway backend port and
      `env -u SPEXCODE_API_URL`, warm the board, then make at least three successive corpus HEAD commits
      and request one full board after each commit. During every phase record `process.memoryUsage()`
      (heapUsed, external, arrayBuffers, rss), the builder/process tree (active builders, child count and
      peak child RSS), the inotify watch count, and the history-cache entry count/bytes. Let each build
      settle before the next commit and record the idle platform after every round; the scratch corpus,
      profile script, and sanitized transcript are evidence only and must not be committed.
    expected: >-
      Each successful full build leaves zero active builders and zero live git/fs children before the
      next round; child RSS returns to its idle platform. JS heap and native/external memory, process RSS,
      inotify watches, and history-cache entries converge to a bounded plateau rather than growing with
      the number of successful HEADs or retaining a full index per historical commit. A bounded increase
      from cold startup is acceptable only when it stabilizes across later rounds; a monotonic RSS/heap,
      child, watcher, or cache count is a failure even when every HTTP request returned 200.
  - name: session-projection-era-gate
    tags: [backend-api]
    description: >-
      Use the default-Node supervisor and a throwaway production-shaped corpus with at least 53 linked
      worktrees and 30 governed session records. A: with zero `/api/graph/stream?mode=delta` subscribers,
      issue a cold `/api/graph` and inspect its session projection phases plus the process tree. B: open one
      delta subscriber, wait for the 30 live summaries to settle, then trigger at least three full invalidations
      and sample `/health`, RSS, and classified backend descendants until each build settles. Close the
      subscriber, trigger one more invalidation, reconnect once, and open one scoped Evals demand route for a
      session. Do not call a deployed endpoint, lower the corpus size, force GC, or use a production-only branch.
    expected: >-
      A returns an honest cold/stale graph while all 30 summaries remain `loading` or last-known and starts
      zero session-eval git work. B starts the eager batch only for the delta era; the default bounded queue
      never overlaps more direct git children than its queue capacity plus the fixed per-job probe constant,
      `/health` stays available, all active backend descendants (git/node/shell/zombie) reach zero after settle,
      and RSS reaches a natural plateau across repeated full invalidations. The last subscriber prevents new
      queued jobs while an in-flight job settles; one reconnect does not enqueue the same generation twice; the
      explicit scoped Evals demand still builds its selected session without requiring a delta subscriber. Any
      unbounded history preheat or monotonic post-settle RSS/child count fails this scenario.
  - name: plain-cold-board-bounds-git-fanout
    tags: [backend-api]
    description: >-
      A/B the real plain cold `/api/graph` surface on the same production-shaped local corpus (about 440 nodes,
      53 linked worktrees, and 30 governed session records) with zero delta subscribers. A is the unmodified
      parent commit; B is the candidate commit. Launch each through the default Node supervisor on its own free
      port with isolated runtime state and no inherited `SPEXCODE_API_URL`. From process start until board settle,
      sample `/health`, backend RSS, and every descendant often enough to count concurrently active git children;
      save the graph response, status, timing, ETag, projection phases, and sanitized process metrics. Run B for
      three cold/full-invalidated rounds and wait for descendants to settle after each; a round counts only once
      the server itself reports the invalidation, so a poll that lands on the previous still-fresh board can never
      be scored as a rebuild. Measure on an idle host — a run whose ambient CPU, run-queue, memory or swap
      conditions break mid-flight is environment-invalid, neither pass nor fail. Never call a deployed
      endpoint, reduce the corpus, force GC, increase a timeout or memory budget, or delete history.
    expected: >-
      B's cold graph is content-equivalent to A and preserves its serialization/ETag and session overlay meaning;
      `/health` remains 200 throughout. Peak active git children never exceeds one documented constant independent
      of the 53-worktree/30-session corpus, all children and queued work reach zero after every build, and RSS is
      substantially below A's unbounded-fanout peak then naturally plateaus across three rounds. With zero delta
      subscribers the build starts no session-eval projection warmup. Opening a delta era afterward still drains
      projection work through its own bounded queue, and one selected Evals demand still completes. The first cold
      read, which has no last-good board to serve, may answer an honest route timeout rather than hold the
      connection open, provided that same single-flight build settles fresh within the build watchdog; that is the
      truthful cold seam, not a loss. Loss is a build that never settles, an ordinary reader still answering 503 or
      timing out once a last-good board exists, an overlapping second flight,
      changed graph units/ETag semantics, any per-reading `merge-base --is-ancestor` fanout, a corpus-sized
      process peak, unreaped descendants, or monotonic RSS.
  - name: session-projection-overtakes-structural-full
    tags: [backend-api]
    test: spec-cli/src/graphStream.api.test.ts
    code: spec-cli/src/graphCache.ts
    related: [spec-cli/src/graphStream.ts, spec-cli/src/graph.ts]
    description: >-
      Warm a real isolated backend and delta subscriber, create a real full-domain change, and hold the
      route-owned or patrol-owned full producer at a controlled git barrier. Persist a real session rename through
      its HTTP route while that full remains held; retain the full across a second cold-tick interval, then release
      it and inspect the raw SSE frames, final graph, and DEBUG trigger ledger.
    expected: >-
      The target session delta arrives before the held full is released, using a session-only projection over
      last-good topology. The one structural full remains single-flight and completes once released; its new
      nodes/ops survive, its session rows never regress after the target frame, and at most one later session
      generation remains owed for cheap convergence. A sessions splice does not walk full topology inputs, stale
      reads do not manufacture a full beside a held splice, and a patrol-owned full retains patrol attribution
      through the early session frame without amplifying into a patrol successor treadmill.
  - name: cold-board-batches-freshness-per-read
    tags: [backend-api]
    code: spec-cli/src/graph.ts
    related: [spec-eval/src/evaltab.ts, spec-eval/src/freshness.ts, spec-cli/src/anchors.ts, spec-cli/src/git.ts]
    description: >-
      A/B one cold board assembly over a corpus that actually carries anchored eval readings. Hold the CORPUS
      fixed and vary only the builder binary — run the candidate's `spex` with its working directory set to a
      clone checked out at the parent commit — so nothing but the code differs. Count the build's git children
      with a PATH shim that logs every invocation, and record wall clock and peak RSS. Then drive the real HTTP
      surface: launch each binary through the default Node supervisor on its own free port, with isolated
      runtime state and no inherited `SPEXCODE_API_URL`, never touching a deployed backend; issue three
      successive `/api/graph` reads from a cold start and sample `/health` throughout. Repeat the binary
      comparison at several pinned history depths so the claim is not one lucky tip.
    expected: >-
      The serialized board is byte-identical between the two binaries at every pinned tip — the batch is a cost
      boundary and owes exactly this equality. One cold build's git children are bounded by the READ: the anchor
      engine's object reads appear as a handful of chunked `cat-file --batch` calls plus one hunk query per
      distinct governed path, and their count does not grow one-for-one with the anchored-reading count. The
      first cold `/api/graph` read answers 200 inside the route timeout rather than 503, later reads hit the
      cache, and `/health` answers 200 throughout. Peak build RSS stays at or below the per-reading path's.
      Loss is: a board differing by one byte, `cat-file --batch`/`--batch-check` re-spawned per reading, a
      first cold read still exhausting the route timeout, a `/health` non-200 during assembly, or RSS above
      the per-reading peak. Lengthening the route timeout, the patrol interval or the memory budget instead of
      lowering the work is loss, not a pass.
---
# eval.md — board-cache

The board build is measured by **driving the real backend under a poll storm** (backend YATU through the
HTTP surface, not a unit test): does a normal dashboard's overlapping `/api/graph` polls stay cheap, and
does the git-free `/health` liveness probe keep answering *while* the board is being read? The loss signal
here is a latency budget — a regression that re-introduces per-poll rebuilds or a synchronous build stall
shows up as a wedged `/health`, exactly the symptom this node exists to prevent. See [[graph-cache]].
