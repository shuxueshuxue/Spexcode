---
concern: a refused resume returns before its own session-dir writes settle: teardown ENOTEMPTY under load, real-store residue without a fixture home
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: launch
created: 2026-08-05T20:19:04.563Z
---

Spec: launch

A refused `resumeSession` returns before its own writes into the session record directory have settled. The
symptom is an intermittent test teardown failure; the same late write is the shape of a store leak when no
fixture home is in scope, so it is one mechanism with two faces.

## What was measured

Running `spec-cli`'s full suite (tree `b444a83ea`) under a fresh HOME:

```
# tests 631   # pass 628   # fail 2   (1 top-level + its subtest)
not ok 589 - resume missing, failed, or invalidated readiness preserves the stopped offline record
    not ok 4 - invalidated
      error: "ENOTEMPTY: directory not empty, rmdir
        '/tmp/spex-resume-ready-invalidated-j1tYqS/projects/-home-jeffry-spexcode/sessions/resume-ready-invalidated-1500734'"
      stack: Object.rmdirSync -> _rmdirSync -> rimrafSync   (sessions.test.ts:19:4352)
```

`ENOTEMPTY` from rimraf means a file appeared inside that directory **after** rimraf had enumerated it. Node's
`rmSync` defaults to `maxRetries: 0`, so a single late write is enough. The test had already asserted the
record content was restored (`assert.deepEqual(stored, original)` passed), so this is a write that happens
after the refusal has returned and after the record has been put back.

Reproduction, measured:

| reading | scope | result |
|---|---|---|
| 1 | full suite, `b444a83ea`, decoy HOME | **fails**, 1 `ENOTEMPTY` |
| 2, 3 | full suite, `f5daab599`, fresh decoy HOMEs | clean, 630/631 pass, 1 skipped, exit 0 |
| 4, 5, 6 | `sessions.test.ts` alone (decoy HOME ×2, real HOME ×1) | clean, 28/28 each, 0 `ENOTEMPTY` |

So it is **load-dependent** (only under the full concurrent suite) and **HOME-independent** (decoy and real
HOME behave alike; the failing path is the test's own `/tmp` fixture home). One occurrence in four full-suite
readings.

## Why this is not merely a flaky test

The same late write is the leak. `sessions.test.ts`'s teardown restores `SPEXCODE_HOME` to its previous value
**before** it `rmSync`s the fixture root:

```
process.env.SPEXCODE_HOME = previousHome     // restore first
...
rmSync(home, { recursive: true, force: true })
assert.equal(existsSync(home), false, `${outcome} resume fixture root is removed exactly`)
```

A late write that fires *before* the restore lands in the fixture and races `rmSync` — the `ENOTEMPTY` above.
A late write that fires *after* the restore lands in whatever home was restored: the disposable one when the
test-home bootstrap is in scope, and the user's real `~/.spexcode` when it is not. That second face is exactly
the residue this repo already has: 13 directories at
`~/.spexcode/projects/-home-jeffry-spexcode/sessions/unit-rvd-{moved,stale,retire}-<pid>-<epoch>/`, six of them
containing a single `rv.path`. Same project key, same file, one level below the `projects/-tmp-*` glob that the
old `test-home-isolation` axis watched — which is why that leak read as delta zero (filed separately, repaired
at `9d1339680`).

## Candidate writer — not proven

`stampRvSock` (`spec-cli/src/harness.ts:407`) is the only writer of a file inside a session record directory on
the launch path, and it writes exactly `rv.path` (`rvStamp`, `harness.ts:401`). It is called from
`sessions.ts:1384` under `if (harness.ownsRendezvous)`. That matches the residue's filename and the failing
directory, but I have **not** shown that this specific call is the one arriving late — rimraf's error names the
directory, not the file, and the directory is partly deleted by the time the assertion fires.

Discriminating experiment, for whoever takes this: capture the directory listing at the moment of failure
instead of inferring it — retry `rmSync` once with `maxRetries` and, on the retry, log the contents that
survived the first pass. That names the file and settles the writer in one reading. Do not fix by adding
retries: that hides it.

## The contract question

Whatever the writer turns out to be, the intent worth stating is upstream of the test: **a refusal that returns
before its own writes have settled is not a refusal.** `launch` already requires `reopen` to wait for its
rendezvous socket before returning, so the successful path is quiesced by contract; the refused path is not,
and every caller inherits an unbounded late write it cannot see. Reordering the test's teardown would silence
the flake and leave the leak; the honest repair is at the refusal boundary.
