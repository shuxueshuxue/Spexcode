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
