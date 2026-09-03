---
concern: spec-cli npm test never finishes: graphScope's tmux gate is unreachable and --test-timeout=0 turns the block into an unbounded hang
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: open
nodes: graph-cache
created: 2026-09-03T16:02:23.431Z
---

Spec: graph-cache

`npm test` in `spec-cli` never finishes. `src/graphScope.test.ts` fails three tests and then hangs
forever, and because the suite is invoked with `--test-timeout=0` nothing ever kills it. I found a
stale run of it on this box that had been spinning for **1h 06m** with zero bytes of output — which
is also why three earlier background attempts at this suite were killed with empty output files.

**Pre-existing and shared, not lane-local.** Identical on trunk `/home/jeffry/spexcode` main and on
this branch — same three tests, same hang, same `exit 124` under an external `timeout`:

    npx tsx --import ../scripts/test-home.mjs --test --test-timeout=20000 src/graphScope.test.ts
    ✔ spliceSessions is byte-identical to a fresh buildBoard when only session state moved
    ✔ boardCache scope: sessions-scoped splices …
    ✔ a full signal whose board inputs did not move discharges without a structural assembly
    ✔ boardCache DEBUG cache commits report one successful full and sessions publication only
    ✖ a held old-topology splice rebases after full completion and cannot erase nodes or ops
    ✖ a splice retains its base full revision so patrol still repairs an unseen topology change
    ✖ a second session invalidation during one splice converges to its newest generation
    (then: Interrupted while running ⚠ src/graphScope.test.ts)

This branch touches neither `graphScope.test.ts` nor `graphScope.ts` (`git diff main...HEAD` on both
is empty).

**The three failures are one assertion.** Run alone, the test completes and reports it:

    AssertionError: the session splice never reached its controlled tmux gate
        at waitForFile (src/graphScope.test.ts:91)
        at TestContext.<anonymous> (src/graphScope.test.ts:357)

`gatedTmux` prepends a fake `tmux` to PATH, the test writes a hold file, triggers a sessions-scoped
splice, then waits 2s for that fake to be *invoked*. It never is. So the reading is not a flake: the
sessions splice no longer shells out to tmux on the path these tests gate, which makes the gate
unreachable and the held-splice concurrency they exist to prove **unmeasured**. Either the liveness
probe moved off `tmux` and the gate must move with it, or a call these tests depend on was lost.

**The hang is the next test**, `a held session splice keeps stale reads refreshing without starting a
full revision walk` (line 437) — the first one after the three failures, and the only one whose name
still promises a *held* splice. A per-test `--test-timeout` does **not** rescue it: with
`--test-timeout=20000` the file still hit an external 200s timeout, so whatever blocks is outside a
test body the runner can cancel.

**Two separable defects, worth not merging into one.** (1) The gate is unreachable, so three
concurrency contracts are silently unproven. (2) `npm test` uses `--test-timeout=0`, so any block
becomes an unbounded hang instead of a failure — that is what turned one broken fixture into an
hour-long invisible process and three killed CI-ish runs with no output at all. Fixing (2) makes (1)
loud, and is worth doing even if (1) is fixed first.

**Retraction of my own earlier reading.** I previously recorded this suite as "exit 0, 60 passing, 0
failures". That cannot have been the full suite — this file alone holds 11 tests and the run does not
complete. Treat the earlier number as void, not as a regression baseline. Its polarity is the usual
one: the wrong reading pointed at "no problem".

Reporting rather than fixing: `graph-cache` is not the machine-routing lane this branch owns, and
both defects want their own commit and their own reading.

<!-- reply: 8bb006f2-ff07-46c9-a216-83c6e32f7777 @ 2026-09-03T16:06:30.940Z -->
Correction on one attribution, and a sharpening of the second defect.

I wrote that the suite "is invoked with `--test-timeout=0`". The script sets no timeout at all:

    spec-cli/package.json:35
    "test": "tsx --import ../scripts/test-home.mjs --test src/*.test.ts"

The `--test-timeout=0` I read off the runner child's argv is Node's OWN default being rendered
explicitly, not something the script passes. Verified directly:

    // a test that never resolves
    node --test tt.test.mjs                        -> external timeout, exit 124 (never cancelled)
    node --test --test-timeout=3000 tt.test.mjs    -> exit 1, "test timed out after 3000ms"

So the fix is "pass a `--test-timeout`", not "stop passing 0". The effective value is the same; the
edit site is different.

That control experiment also sharpens the graphScope diagnosis rather than softening it. A plain
hanging test body IS cancellable — Node reports it as a failure in 3s. graphScope still hit an
external 200s timeout under `--test-timeout=20000`, so what blocks there is not a slow or stuck test
body: something is holding the runner open after the test the runner could cancel. The fixture
children are the obvious suspect — `gatedTmux`/`gatedGit` install shell fakes that spin on
`while [ -e "$hold" ]; do sleep 0.01; done`, and a failing test leaves its hold file behind (the
`/tmp/boardscope-*-gate-*/hold-tmux` and `hold-git` files outlive the run). A per-test timeout cannot
reap a grandchild shell.

That makes the two defects sequential, not parallel: adding `--test-timeout` turns the three
assertion failures loud, and the leaked fixture child is what still has to be released in a `finally`
before the file can finish at all.
