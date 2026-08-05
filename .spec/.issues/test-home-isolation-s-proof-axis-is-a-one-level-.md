---
concern: test-home-isolation's proof axis is a one-level glob, so a test minting session-record dirs in the real store reads as delta zero
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: test-home-isolation
created: 2026-08-05T19:38:34.355Z
---

Spec: test-home-isolation

## The axis measures one level, the class it names lives one level deeper

`temporary-root-never-grows-user-home` counts `~/.spexcode/projects/-tmp-*` before and after the package
test command. Session records do not live there — they live at
`~/.spexcode/projects/<project>/sessions/<id>/`, one level deeper, inside a project directory that already
existed and whose name never matches `-tmp-*`. **A test that mints session-record directories in the REAL
project store moves neither the `-tmp-*` count nor a whole-`projects/` count, so the scenario reads delta
zero while the leak it is named for is happening.**

I am the one who signed the merge proof for this node, using exactly that axis plus an all-project count.
Both counters were blind to this. Recording it rather than leaving the coverage claim wider than the
measurement.

## The population the axis cannot see, measured now

15 directories under the REAL store `~/.spexcode/projects/-home-jeffry-spexcode/sessions/` have no
`session.json` — they are not sessions, they are test residue:

    13 × unit-rvd-{moved,stale,retire}-<pid>-<epoch-ms>/     2026-08-05 11:27:07 .. 12:14:44 (local)
     1 × 019f7974-10a6-7481-b51c-c2d157a8a28a/               2026-07-19 19:08:57
     1 × 1f20b7e3-d249-4a7d-8e29-9ae3eeb2e5bc/               2026-08-04 23:27:14

    contents, union of basenames: 6 × rv.path · 2 × spec-checked · 2 × spec-of-file-seen

The `unit-rvd-*` names carry a pid and an epoch-ms stamp, so they are unit-test constructions, not sessions
whose record was lost. `ls sessions | wc -l` there reads **30**; only **15** are session records.

## This does not contradict the landed fix — and that is checkable, not assumed

Every residue directory has an mtime at or before `2026-08-05 12:14:44` local. The fix landed
(`c12832648`) and the verifying suite ran after `2026-08-06 01:13` local. **Zero residue directories were
created by that run.** So the class is pre-fix, and the record-directory axis, applied retrospectively to
the same run, also reads zero. The defect here is the proof's reach, not the repair.

## Why widening the glob is the wrong repair

Adding `sessions/*` to the pattern fixes this instance and leaves the shape intact: the next writer picks a
path the enumeration does not name, and the scenario reads zero again. The axis fails **silently** when it
is pointed at the wrong subtree, which is the property that made it look like evidence.

A criterion that cannot be blind by construction: stamp the run's start, then enumerate everything under
`~/.spexcode` whose mtime is newer, and require the set to be empty. That names no path, so a new writer
cannot escape it, and an empty result is only reachable by nothing having been written.

Second, note what `delta 0` on this axis does and does not say. The real store currently holds **25800**
`-tmp-*` project directories. The scenario proves the pile did not grow; it does not say the pile is clean,
and a reader who sees `delta 0` will hear the second claim. Whatever the axis becomes should report the
absolute standing count alongside the delta so the two cannot be confused.

## Not done here

The 15 residue directories are the user's home data and are left in place; removing them is not this
issue's business and was not authorized.

<!-- reply: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19 @ 2026-08-05T19:45:07.879Z -->
## The residue's producer: an unmerged commit, and it is not readable from main

Tracing the residue names rather than assuming their origin. The current tree builds only
`unit-rvd-{ok,kick,wall,none}-<pid>-<epoch>` ids (`spec-cli/src/harness.test.ts:2110-2147`). The three names
on disk — `moved`, `stale`, `retire` — appear nowhere at HEAD:

    git show main:spec-cli/src/harness.test.ts | grep -c 'unit-rvd-{moved,retire,stale}'   →  0

They come from one commit:

    ec1c3a9d9  2026-08-05 12:15:14 +0800  fix(harness): deliver to a conversation that moved into a background job
      contains the names:        yes
      ancestor of main:          NO
      branches containing it:    none  (dangling — reachable only through the reflog)

The last residue directory was written at **2026-08-05 12:14:44**, thirty seconds before that commit was
authored. That is the signature of a test run immediately preceding a commit on a session branch whose work
never landed and whose branch is gone.

### What this changes about the finding

**It does not weaken the landed repair — it explains why a mechanical repair was the right kind.** The
polluting writer was never on main, so no amount of reading main would find it, and no gate that runs only
on main would have stopped it. A bootstrap that redirects `SPEXCODE_HOME` for any invocation of the package
test command is branch-independent by construction; that is exactly the property this class needs.

**It sharpens the axis complaint.** The scenario's job is to prove the mechanism holds for whatever tree is
under test, and the axis it uses cannot see the class of write that actually happened. A worker on a branch
runs the same package command, so an axis that goes blind on record directories goes blind for every branch
too.

**It also bounds the population honestly.** These 15 directories are one dead branch's test run plus two
older marker-only directories, not an ongoing leak: nothing under that store has been written by a test
since the fix landed.

<!-- reply: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19 @ 2026-08-05T20:18:21.197Z -->
Repaired and landed at `9d1339680`. Two corrections to what I proposed above, both from measurement.

**1. The mtime criterion I proposed here is unusable. Do not adopt it.**

I proposed: stamp the run's start, enumerate everything under the real `~/.spexcode` with a newer mtime,
require the empty set. Measured on this host: **5 entries newer than the stamp inside a ~1 minute window with
no test writing there at all** — live backends write into that store continuously. On any machine running a
deployment it reads non-empty always. Blindness is a criterion that always passes; this one always fails.
Opposite direction, same worth.

The property that made it attractive survives: it names no path, so the next writer cannot escape it. The way
to keep that property is not to watch the store harder — it is to **move the store**. Point `HOME` at a fresh
empty directory and the location the product resolves as the user's persistent store is one nobody else can
reach. Path-agnostic like the mtime idea, and noise-free because it has no other writers. That is what landed.

**2. Two of my own drafted claims were false and the text moved to the measurement.**

- I wrote that nothing should be written *anywhere* under the decoy HOME. False: every run leaves seven
  non-store entries — `.bash_history`, `.cache`, `.codex/config.toml`, `.pi/agent/trust.json`. The suite
  launches real harness child processes and they write their own configuration into whatever HOME they get.
  The criterion is **store-scoped**, and those entries are now read as the cheapest confirmation that the
  decoy really was the HOME the child processes resolved — a second positive control, for free.
- I wrote that both package test commands pass. `spec-eval` does (173/173, three-for-three). `spec-cli` did
  **not** in the first reading: exit 1, 628/631, on a teardown `ENOTEMPTY` in `resume … invalidated`. Three
  single-file readings of that test were clean and two later full-suite readings were clean (630/631 pass,
  1 skipped, exit 0), so it is load-dependent and HOME-independent. Filed separately against `launch`; the
  store reading in that same failing run was clean, so it is not this criterion's subject.

**What the reading actually shows.** Negative: decoy `.spexcode` absent for `spec-cli` in three readings and
`spec-eval` in three. Positive: one session artifact through the product's own `sessionArtifactPath` fills the
decoy at `.spexcode/projects/-home-jeffry-spexcode/sessions/unit-detector-probe-<pid>/rv.path` — the same
shape as the 13 historical residue directories. Old axis on that very write: `projects/-tmp-*` = **0**, blind
as claimed.

The prior scenario is kept, not rewritten. It is narrow rather than wrong, and replacing it would throw away a
valid measurement.
